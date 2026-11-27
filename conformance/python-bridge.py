#!/usr/bin/env python3
"""JSONL request/response bridge for the black-box Host conformance suite.

The bridge is the only place that knows the Python Host package layout and the
small naming differences between the public TypeScript HostConfig and the
public Python Host.start config.
"""

from __future__ import annotations

import asyncio
import io
import json
import os
import sys
import threading
import traceback
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent


def configure_stdio() -> None:
    """Use UTF-8 for JSONL even when the Windows locale is cp1251."""
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        if stream is None:
            continue
        try:
            stream.reconfigure(encoding="utf-8", errors="strict")
        except (AttributeError, io.UnsupportedOperation):
            pass


configure_stdio()
PROTOCOL_OUT = sys.stdout


def host_directory() -> Path | None:
    candidates: list[Path] = []
    configured = os.environ.get("MMP_PYTHON_HOST_DIR")
    if configured:
        candidates.append(Path(configured))
    candidates.extend([HERE / "python-host", HERE.parent / "python-host"])
    for candidate in candidates:
        if (candidate / "pyproject.toml").is_file():
            return candidate
    return None


def install_host_path() -> None:
    directory = host_directory()
    if directory is None:
        return
    for candidate in (directory, directory / "src"):
        path = str(candidate)
        if candidate.is_dir() and path not in sys.path:
            sys.path.insert(0, path)


install_host_path()
try:
    from mmp_host import Host, MMPError
except Exception as exc:  # noqa: BLE001 - startup diagnostics
    print(json.dumps({"op": "fatal", "message": f"Cannot import mmp_host: {exc}"}), flush=True)
    traceback.print_exc(file=sys.stderr)
    raise SystemExit(3)


def mmp_error(exc: BaseException) -> dict[str, Any] | None:
    if not isinstance(exc, MMPError) or not hasattr(exc, "as_dict"):
        return None
    data = dict(exc.as_dict())
    if "correlationId" not in data and "correlation_id" in data:
        data["correlationId"] = data.pop("correlation_id")
    return data


def failure(exc: BaseException) -> dict[str, Any]:
    return {
        "message": f"{type(exc).__name__}: {exc}",
        "traceback": traceback.format_exc(),
    }


def success(result: Any) -> dict[str, Any]:
    if hasattr(result, "structured_content"):
        value = result.structured_content
    elif hasattr(result, "model_dump") and not isinstance(result, dict):
        value = result.model_dump()
    else:
        value = result
    return {
        "structuredContent": value,
        "content": [{"type": "text", "text": json.dumps(value, ensure_ascii=False)}],
    }


class Bridge:
    def __init__(self) -> None:
        self.host: Host | None = None
        self.tasks: dict[int, asyncio.Task[None]] = {}
        self.out_lock = asyncio.Lock()
        self.stop = asyncio.Event()

    async def send(self, message: dict[str, Any]) -> None:
        line = json.dumps(message, ensure_ascii=False, separators=(",", ":"))
        async with self.out_lock:
            PROTOCOL_OUT.write(f"{line}\n")
            PROTOCOL_OUT.flush()

    async def invoke(self, request_id: int, message: dict[str, Any]) -> None:
        try:
            if self.host is None:
                raise RuntimeError("Host is not started")
            options = message.get("options") or {}
            result = await self.host.invoke(
                message["caller"], message["invocation"], deadline_ms=options.get("deadline_ms")
            )
            await self.send({"id": request_id, "ok": True, "value": success(result)})
        except asyncio.CancelledError as exc:
            # The Python Host must translate running cancellation into MMPError.
            # A raw asyncio.CancelledError is a conformance failure, not a wire error.
            await self.send({"id": request_id, "ok": False, "failure": failure(exc)})
        except Exception as exc:  # noqa: BLE001 - classify only real MMPError as wire
            typed = mmp_error(exc)
            if typed is not None:
                await self.send({"id": request_id, "ok": False, "error": typed})
            else:
                print(f"python-bridge: {type(exc).__name__}: {exc}", file=sys.stderr, flush=True)
                await self.send({"id": request_id, "ok": False, "failure": failure(exc)})
        finally:
            self.tasks.pop(request_id, None)

    async def handle(self, message: dict[str, Any]) -> None:
        request_id = message.get("id")
        operation = message.get("op")
        try:
            if operation == "start":
                self.host = await Host.start(message["config"])
                await self.send({"id": request_id, "ok": True, "value": {"gateway": self.host.gateway}})
            elif operation == "call":
                task = asyncio.create_task(self.invoke(request_id, message))
                self.tasks[request_id] = task
                # Let the invocation enter its try block before a cancel can arrive.
                await asyncio.sleep(0)
            elif operation == "cancel":
                task = self.tasks.pop(message["target"], None)
                if task is not None:
                    task.cancel()
                await self.send({"id": request_id, "ok": True})
            elif operation == "select":
                if self.host is None:
                    raise RuntimeError("Host is not started")
                triple = message["triple"]
                self.host.select(
                    (triple["capability"], triple["inputContract"], triple["outputContract"]),
                    message["moduleId"],
                )
                await self.send({"id": request_id, "ok": True})
            elif operation == "close":
                if self.host is not None:
                    await self.host.close()
                    self.host = None
                await self.send({"id": request_id, "ok": True})
                self.stop.set()
            else:
                raise ValueError(f"Unknown bridge operation: {operation}")
        except Exception as exc:  # noqa: BLE001 - report protocol failures as data
            typed = mmp_error(exc)
            if typed is not None:
                await self.send({"id": request_id, "ok": False, "error": typed})
            else:
                print(f"python-bridge: {type(exc).__name__}: {exc}", file=sys.stderr, flush=True)
                await self.send({"id": request_id, "ok": False, "failure": failure(exc)})

    async def run(self) -> None:
        queue: asyncio.Queue[str | None] = asyncio.Queue()
        loop = asyncio.get_running_loop()

        def read_stdin() -> None:
            for line in sys.stdin:
                loop.call_soon_threadsafe(queue.put_nowait, line)
            loop.call_soon_threadsafe(queue.put_nowait, None)

        threading.Thread(target=read_stdin, daemon=True).start()
        while not self.stop.is_set():
            line = await queue.get()
            if line is None:
                break
            if not line.strip():
                continue
            try:
                message = json.loads(line)
            except json.JSONDecodeError:
                await self.send({"op": "fatal", "message": "Invalid JSON request"})
                break
            await self.handle(message)
        for task in list(self.tasks.values()):
            task.cancel()
        if self.tasks:
            await asyncio.gather(*self.tasks.values(), return_exceptions=True)
        if self.host is not None:
            await self.host.close()
            self.host = None


def main() -> None:
    # Keep any Host or library stdout output away from the JSONL protocol.
    sys.stdout = sys.stderr
    try:
        asyncio.run(Bridge().run())
    except Exception as exc:  # noqa: BLE001 - startup diagnostics
        PROTOCOL_OUT.write(json.dumps({"op": "fatal", "message": f"Python bridge crashed: {exc}"}) + "\n")
        PROTOCOL_OUT.flush()
        traceback.print_exc(file=sys.stderr)
        raise SystemExit(3)


if __name__ == "__main__":
    main()
