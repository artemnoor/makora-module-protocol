from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
import secrets
import socket
import time
import uuid
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import jsonschema
import mcp.types as mcp_types
from mcp import Client, StdioServerParameters
from mcp.server.lowlevel import Server
from mcp.types import CallToolResult
from referencing import Registry, Resource

EXT = "io.github.artemnoor/mmp"
CTX_META = "io.github.artemnoor/mmp-context"
ERR_META = "io.github.artemnoor/mmp-error"
GRANT_META = "io.github.artemnoor/mmp-grant"
MCP_REV = "2026-07-28"
SEMVER = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$")
CONTRACT_PATTERN = r"^urn:mmp:[a-z0-9][a-z0-9:._-]*:[0-9]+\.[0-9]+\.[0-9]+(?:[-+][a-zA-Z0-9.+-]+)?$"
SCHEMA_DIR = Path(__file__).parent / "schemas"
MAX_LIST_PAGES = 100
MAX_PAGE_CURSORS = 1024
IN_FLIGHT_TTL = 86400.0


@dataclass(frozen=True)
class Contract:
    id: str
    file: str
    sha256: str


@dataclass(frozen=True)
class Provider:
    id: str
    publisher: str
    version: str
    command: str
    root: str | None = None
    args: tuple[str, ...] = ()
    env: dict[str, str] = field(default_factory=dict)
    files: dict[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class Grant:
    caller: str
    target: str
    tool: str
    effects: str
    permissions: tuple[str, ...] = ()


@dataclass
class _Admitted:
    config: Provider
    descriptor: dict[str, Any]
    client: Client
    tools: dict[str, Any]
    operations: dict[tuple[str, str, str], dict[str, Any]]
    owner: asyncio.Task
    close_event: asyncio.Event


@dataclass
class _Context:
    token: str
    caller: str
    provider: _Admitted
    operation: dict[str, Any]
    correlation_id: str
    deadline: int
    max_depth: int
    chain: list[str]
    deps: set[tuple[str, str, str]]
    selections: dict[tuple[str, str, str], _Admitted]
    children: set[asyncio.Task] = field(default_factory=set)


class MMPError(Exception):
    def __init__(self, kind: str, message: str, *, retryable: bool = False,
                 outcome: str = "not-started", correlation_id: str = ""):
        super().__init__(message)
        self.kind, self.message, self.retryable = kind, message, retryable
        self.outcome, self.correlation_id = outcome, correlation_id

    def as_dict(self) -> dict[str, Any]:
        return {"kind": self.kind, "message": self.message, "retryable": self.retryable,
                "outcome": self.outcome, "correlationId": self.correlation_id}


class Host:
    """MMP host. Root calls are async; providers use authenticated loopback MCP HTTP."""

    def __init__(self, *, contracts: list[Contract], known_permissions: set[str] | None = None,
                 grants: list[Grant] | None = None, address: tuple[str, int] = ("127.0.0.1", 0),
                 max_message_bytes: int = 1_048_576, max_data_depth: int = 64,
                 timeout_seconds: int = 60, max_depth: int = 16,
                 max_dedup_entries: int = 1024):
        self.contract_refs = {c.id: c for c in contracts}
        self.contracts: dict[str, tuple[dict[str, Any], jsonschema.Draft202012Validator]] = {}
        self.known_permissions = known_permissions or set()
        self.grants = {(g.caller, g.target, g.tool): g for g in (grants or [])}
        self.requested_address = address
        self.address: tuple[str, int] | None = None
        self.authority: str | None = None
        self.origin: str | None = None
        self.max_message_bytes, self.max_data_depth = max_message_bytes, max_data_depth
        self.timeout_seconds, self.default_max_depth = timeout_seconds, max_depth
        self.max_dedup_entries = max(1, max_dedup_entries)
        self.providers: dict[str, _Admitted] = {}
        self._reserved_provider_ids: set[str] = set()
        self.selected: dict[tuple[str, str, str], str] = {}
        self.contexts: dict[str, _Context] = {}
        self.dedup: dict[tuple[str, tuple[str, str, str], str], tuple[str, asyncio.Future | None, Any, float, tuple[str, str, str]]] = {}
        self.credentials: dict[str, str] = {}
        self.host_grants: dict[str, str] = {}
        self.invoke_schema: dict[str, Any] = {}
        self.error_schema: dict[str, Any] = {}
        self.success_schema: dict[str, Any] = {}
        self._invoke_validator: jsonschema.Draft202012Validator | None = None
        self._error_validator: jsonschema.Draft202012Validator | None = None
        self._success_validator: jsonschema.Draft202012Validator | None = None
        self._descriptor_schema: dict[str, Any] | None = None
        self._server = None
        self._server_task: asyncio.Task | None = None
        self._socket: socket.socket | None = None
        self._closed = False
        self._lock = asyncio.Lock()

    @classmethod
    async def start(cls, config: dict[str, Any]) -> Host:
        """Construct and start from camelCase configuration."""
        contracts = [c if isinstance(c, Contract) else Contract(c["id"], c["file"], c["sha256"])
                     for c in config.get("contracts", [])]
        providers = [p if isinstance(p, Provider) else Provider(
            id=p["id"], publisher=p["publisher"], version=p["version"], command=p["command"],
            root=p.get("root", p.get("cwd")), args=tuple(p.get("args", [])),
            env=p.get("env", {}), files=p.get("files", {}))
            for p in config.get("providers", [])]
        grants = [g if isinstance(g, Grant) else Grant(
            caller=g["caller"], target=g["target"], tool=g["tool"], effects=g["effects"],
            permissions=tuple(g.get("permissions", []))) for g in config.get("grants", [])]
        host = cls(contracts=contracts, known_permissions=set(config.get("knownPermissions", [])), grants=grants,
                   address=tuple(config.get("address", ("127.0.0.1", 0))),
                   max_message_bytes=config.get("maxMessageBytes", 1_048_576),
                   max_data_depth=config.get("maxDataDepth", 64),
                   timeout_seconds=config.get("timeoutSeconds", 60), max_depth=config.get("maxDepth", 16),
                   max_dedup_entries=config.get("maxDedupEntries", 1024))
        await host._start()
        try:
            for provider in providers:
                await host.add_provider(provider)
        except BaseException:
            await host.close()
            raise
        return host

    @property
    def gateway(self) -> str:
        if self.address is None or self.authority is None:
            raise RuntimeError("Host is not started")
        return f"http://{self.authority}/mcp"

    async def _start(self) -> Host:
        if self.address is not None:
            return self
        if not 1_024 <= self.max_message_bytes <= 64 * 1_048_576:
            raise ValueError("maxMessageBytes must be between 1024 and 64 MiB")
        if not 1 <= self.max_data_depth <= 64:
            raise ValueError("maxDataDepth must be between 1 and 64")
        if self.timeout_seconds <= 0:
            raise ValueError("timeoutSeconds must be positive")
        if not 1 <= self.default_max_depth <= 64:
            raise ValueError("maxDepth must be between 1 and 64")
        self._load_schemas()
        loaded: dict[str, dict[str, Any]] = {}
        artifacts: dict[str, dict[str, Any]] = {}
        for cid, ref in self.contract_refs.items():
            raw = Path(ref.file).read_bytes()
            if hashlib.sha256(raw).hexdigest() != ref.sha256.lower():
                raise ValueError(f"contract digest mismatch: {cid}")
            try:
                artifact = json.loads(raw)
            except (TypeError, ValueError) as error:
                raise ValueError(f"contract artifact is not JSON: {cid}") from error
            if not isinstance(artifact, dict) or not isinstance(artifact.get("schema"), dict):
                raise TypeError(f"invalid contract artifact: {cid}")
            if artifact["schema"].get("$id") != cid:
                raise ValueError(f"invalid contract artifact: {cid}")
            schema = artifact["schema"]
            jsonschema.Draft202012Validator.check_schema(schema)
            if _has_external_ref(schema):
                raise ValueError(f"external schema references are forbidden: {cid}")
            loaded[cid] = schema
            artifacts[cid] = artifact
        registry = Registry()
        for schema in loaded.values():
            registry = registry.with_resource(schema["$id"], Resource.from_contents(schema))
        for cid, schema in loaded.items():
            self.contracts[cid] = (schema, jsonschema.Draft202012Validator(schema, registry=registry))
        for cid, artifact in artifacts.items():
            if not isinstance(artifact.get("semantics"), str) or not artifact["semantics"].strip():
                raise ValueError(f"contract semantics are required: {cid}")
            fixtures = artifact.get("fixtures")
            if not isinstance(fixtures, dict) or not isinstance(fixtures.get("valid"), list) \
                    or not isinstance(fixtures.get("invalid"), list):
                raise TypeError(f"contract positive and negative fixtures are required: {cid}")
            validator = self.contracts[cid][1]
            try:
                if any(list(validator.iter_errors(value)) for value in fixtures["valid"]):
                    raise ValueError(f"contract has an invalid positive fixture: {cid}")
                if any(not list(validator.iter_errors(value)) for value in fixtures["invalid"]):
                    raise ValueError(f"contract has a valid negative fixture: {cid}")
            except jsonschema.SchemaError as error:
                raise ValueError(f"contract schema is invalid: {cid}") from error
        host, port = self.requested_address
        if host not in ("127.0.0.1", "localhost"):
            raise ValueError("Gateway must bind to an IPv4 loopback address")
        bind_host = "127.0.0.1"
        self._socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            self._socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            self._socket.bind((bind_host, port))
            self._socket.listen(128)
            self._socket.setblocking(False)
            self.address = self._socket.getsockname()[:2]
            self.authority = f"{self.address[0]}:{self.address[1]}"
            self.origin = f"http://{self.authority}"
            import uvicorn
            app = self._make_gateway_app()
            config = uvicorn.Config(app, host=bind_host, port=self.address[1], log_level="error",
                                    lifespan="on", access_log=False)
            self._server = uvicorn.Server(config)
            self._server_task = asyncio.create_task(self._server.serve(sockets=[self._socket]))
            for _ in range(500):
                if self._server.started:
                    break
                await asyncio.sleep(0.01)
            else:
                raise RuntimeError("Gateway failed to start")
        except BaseException:
            self._closed = True
            if self._server_task:
                self._server_task.cancel()
                await asyncio.gather(self._server_task, return_exceptions=True)
            if self._socket:
                self._socket.close()
            self._socket = None
            self.address = None
            self.authority = None
            self.origin = None
            raise
        return self

    def _load_schemas(self) -> None:
        self.invoke_schema = _read_schema("invoke.schema.json")
        self.error_schema = _read_schema("error.schema.json")
        self._descriptor_schema = _read_schema("module-descriptor.schema.json")
        self.success_schema = {
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "type": "object",
            "additionalProperties": False,
            "required": ["outputContract", "result"],
            "properties": {
                "outputContract": {"type": "string", "pattern": CONTRACT_PATTERN},
                "result": {"description": "A value that satisfies the declared output contract."},
            },
        }
        jsonschema.Draft202012Validator.check_schema(self.invoke_schema)
        jsonschema.Draft202012Validator.check_schema(self.error_schema)
        jsonschema.Draft202012Validator.check_schema(self.success_schema)
        self._invoke_validator = jsonschema.Draft202012Validator(self.invoke_schema)
        self._error_validator = jsonschema.Draft202012Validator(self.error_schema)
        self._success_validator = jsonschema.Draft202012Validator(self.success_schema)

    async def close(self) -> None:
        if self._closed and self.address is None:
            return
        self._closed = True
        for context in tuple(self.contexts.values()):
            for child in tuple(context.children):
                child.cancel()
            self.contexts.pop(context.token, None)
        pending = [entry[1] for entry in self.dedup.values() if entry[1] is not None]
        for future in pending:
            future.cancel()
        if pending:
            await asyncio.gather(*pending, return_exceptions=True)
        self.dedup.clear()
        if self._server:
            self._server.should_exit = True
        if self._server_task:
            try:
                await asyncio.wait_for(asyncio.shield(self._server_task), timeout=10)
            except TimeoutError:
                self._server_task.cancel()
                await asyncio.gather(self._server_task, return_exceptions=True)
            except asyncio.CancelledError:
                self._server_task.cancel()
                await asyncio.gather(self._server_task, return_exceptions=True)
            self._server_task = None
        for provider in tuple(self.providers.values()):
            provider.close_event.set()
        if self.providers:
            await asyncio.gather(*(p.owner for p in self.providers.values()), return_exceptions=True)
        self.providers.clear()
        self._reserved_provider_ids.clear()
        self.credentials.clear()
        self.host_grants.clear()
        self.selected.clear()
        if self._socket:
            self._socket.close()
        self._socket = None
        self.address = None
        self.authority = None
        self.origin = None

    async def add_provider(self, provider: Provider) -> None:
        if self._closed or self.address is None:
            raise RuntimeError("Host is not started or is closed")
        if not SEMVER.fullmatch(provider.version):
            raise ValueError("package version must be exact SemVer")
        command = Path(provider.command)
        if not command.is_absolute():
            raise ValueError("provider command must be an absolute path")
        package_root = Path(provider.root).resolve() if provider.root else command.resolve().parent
        _verify_launch_pin(provider, package_root)
        for rel, digest in provider.files.items():
            _verify_pinned_file(package_root, rel, digest)
        async with self._lock:
            if provider.id in self.providers or provider.id in self._reserved_provider_ids:
                raise ValueError("provider id already admitted or being admitted")
            self._reserved_provider_ids.add(provider.id)
        credential = secrets.token_urlsafe(32)
        host_grant = secrets.token_urlsafe(32)
        self.credentials[provider.id] = credential
        self.host_grants[provider.id] = host_grant
        injected = {"MMP_GATEWAY": self.gateway, "MMP_CREDENTIAL": credential, "MMP_HOST_GRANT": host_grant}
        proc_env = {key: value for key, value in provider.env.items() if key not in injected}
        proc_env.update(injected)
        params = StdioServerParameters(command=provider.command, args=list(provider.args),
                                       env=proc_env, cwd=str(package_root))
        client = Client(params, mode="auto")
        ready = asyncio.get_running_loop().create_future()
        close_event = asyncio.Event()
        owner = asyncio.create_task(self._own_client(client, ready, close_event))
        try:
            await ready
            if self._closed:
                raise RuntimeError("Host closed while admitting provider")
            if client.protocol_version != MCP_REV:
                raise ValueError(f"provider MCP revision must be {MCP_REV}")
            discovery = client.session.discover_result
            if discovery is None:
                raise ValueError("provider did not answer server/discover")
            caps = discovery.capabilities.model_dump(by_alias=True, mode="json")
            extensions = caps.get("extensions")
            descriptor = extensions.get(EXT, {}).get("descriptor") if isinstance(extensions, dict) else None
            if not isinstance(descriptor, dict):
                raise TypeError("provider does not advertise a full MMP descriptor")
            assert self._descriptor_schema is not None
            jsonschema.validate(descriptor, self._descriptor_schema)
            if (descriptor["id"], descriptor["publisher"], descriptor["version"]) != \
                    (provider.id, provider.publisher, provider.version):
                raise ValueError("descriptor identity/version does not match trusted provider pin")
            if descriptor["mmpVersion"] != "0.1.0":
                raise ValueError("unsupported MMP profile")
            if len({op["tool"] for op in descriptor["operations"]}) != len(descriptor["operations"]):
                raise ValueError("duplicate declared tools")
            if any(op["tool"].startswith("mmp_") for op in descriptor["operations"]):
                raise ValueError("reserved tool name")
            for op in descriptor["operations"]:
                for cid in (op["inputContract"], op["outputContract"]):
                    if cid not in self.contracts:
                        raise ValueError(f"contract not pinned: {cid}")
                if any(permission not in self.known_permissions for permission in op["permissions"]):
                    raise ValueError("unknown permission")
                if op["idempotency"]["mode"] == "deduplicated" and op["idempotency"].get("restartPersistent"):
                    raise ValueError("persistent deduplication is unsupported")
            for dependency in descriptor["requires"]:
                if dependency["inputContract"] not in self.contracts \
                        or dependency["outputContract"] not in self.contracts:
                    raise ValueError("required dependency contract is not pinned")
            tools: dict[str, Any] = {}
            cursors: set[str] = set()
            cursor: str | None = None
            for _ in range(MAX_LIST_PAGES):
                page = await client.list_tools(cursor=cursor, cache_mode="refresh")
                for tool in page.tools:
                    if tool.name in tools or tool.name.startswith("mmp_"):
                        raise ValueError("duplicate or reserved provider tool")
                    tools[tool.name] = tool
                cursor = page.next_cursor
                if not cursor:
                    break
                if cursor in cursors or len(cursors) >= MAX_PAGE_CURSORS:
                    raise ValueError("provider tools/list cursor cycle or page bound exceeded")
                cursors.add(cursor)
            else:
                raise ValueError("provider tools/list page bound exceeded")
            operations: dict[tuple[str, str, str], dict[str, Any]] = {}
            for op in descriptor["operations"]:
                tool = tools.get(op["tool"])
                if tool is None:
                    raise ValueError(f"declared tool missing: {op['tool']}")
                advertised_in = tool.input_schema
                advertised_out = getattr(tool, "output_schema", None)
                if _canonical(advertised_in) != _canonical(self.contracts[op["inputContract"]][0]):
                    raise ValueError(f"input schema mismatch: {op['tool']}")
                if advertised_out is None or _canonical(advertised_out) != _canonical(self.contracts[op["outputContract"]][0]):
                    raise ValueError(f"output schema mismatch: {op['tool']}")
                triple = (op["capability"], op["inputContract"], op["outputContract"])
                if triple in operations:
                    raise ValueError("duplicate operation triple")
                operations[triple] = op
            if set(tools) != {op["tool"] for op in descriptor["operations"]}:
                raise ValueError("tools/list does not exactly match declared operations")
            admitted = _Admitted(provider, descriptor, client, tools, operations, owner, close_event)
            async with self._lock:
                if self._closed:
                    raise RuntimeError("Host closed while admitting provider")
                self.providers[provider.id] = admitted
                self._reserved_provider_ids.discard(provider.id)
                for triple in operations:
                    self.selected.setdefault(triple, provider.id)
        except BaseException:
            self._reserved_provider_ids.discard(provider.id)
            self.credentials.pop(provider.id, None)
            self.host_grants.pop(provider.id, None)
            close_event.set()
            await asyncio.gather(owner, return_exceptions=True)
            raise

    async def _own_client(self, client: Client, ready: asyncio.Future, close_event: asyncio.Event) -> None:
        try:
            async with client:
                if not ready.done():
                    ready.set_result(None)
                await close_event.wait()
        except BaseException as error:
            if not ready.done():
                ready.set_exception(error)
            raise

    async def remove_provider(self, provider_id: str) -> None:
        async with self._lock:
            provider = self.providers.pop(provider_id, None)
            self.credentials.pop(provider_id, None)
            self.host_grants.pop(provider_id, None)
        if provider:
            provider.close_event.set()
            await asyncio.gather(provider.owner, return_exceptions=True)
        for triple, selected in tuple(self.selected.items()):
            if selected == provider_id:
                replacement = next((pid for pid, candidate in self.providers.items()
                                    if triple in candidate.operations), None)
                if replacement:
                    self.selected[triple] = replacement
                else:
                    self.selected.pop(triple, None)

    def select(self, triple: tuple[str, str, str], provider_id: str) -> None:
        if provider_id not in self.providers or triple not in self.providers[provider_id].operations:
            raise ValueError("provider does not implement exact triple")
        self.selected[triple] = provider_id

    async def invoke(self, caller: str, request: dict[str, Any], *, deadline_ms: int | None = None,
                     timeout_seconds: float | None = None, max_depth: int | None = None) -> dict[str, Any]:
        if self._closed:
            raise RuntimeError("Host is closed")
        correlation_id = uuid.uuid4().hex
        if not isinstance(caller, str) or not caller.startswith("host:"):
            raise MMPError("PERMISSION_DENIED", "Public root invocation requires a configured host identity",
                           correlation_id=correlation_id)
        return await self._invoke(caller, request, deadline_ms=deadline_ms, timeout_seconds=timeout_seconds,
                                  max_depth=max_depth, context=None)

    async def _invoke(self, caller: str, request: dict[str, Any], *, deadline_ms: int | None = None,
                      timeout_seconds: float | None = None, max_depth: int | None = None,
                      context: _Context | None = None) -> dict[str, Any]:
        correlation_id = context.correlation_id if context else uuid.uuid4().hex
        self._validate_invoke(request, correlation_id)
        triple = (request["capability"], request["inputContract"], request["outputContract"])
        arguments = request["arguments"]
        args_hash = self._bounded_canonical(arguments, correlation_id, "Input data")
        if context:
            if context.caller != caller:
                raise MMPError("PERMISSION_DENIED", "Caller identity mismatch", correlation_id=correlation_id)
            if triple not in context.deps:
                raise MMPError("PERMISSION_DENIED", "Dependency was not declared", correlation_id=correlation_id)
            chain = context.chain
            deadline = context.deadline
            depth_limit = context.max_depth
            route_snapshot = dict(context.selections)
        else:
            chain = []
            deadline = deadline_ms if deadline_ms is not None else \
                _now_ms() + int((timeout_seconds if timeout_seconds is not None else self.timeout_seconds) * 1000)
            depth_limit = self.default_max_depth if max_depth is None else max_depth
            route_snapshot = {triple: provider for triple, provider_id in self.selected.items()
                              if (provider := self.providers.get(provider_id)) is not None
                              and triple in provider.operations}
        if deadline <= _now_ms():
            raise MMPError("DEADLINE_EXCEEDED", "Deadline exceeded", correlation_id=correlation_id)
        if triple[0] in chain:
            raise MMPError("CYCLE_DETECTED", "Capability cycle detected", correlation_id=correlation_id)
        if len(chain) >= depth_limit:
            raise MMPError("MAX_DEPTH_EXCEEDED", "Maximum call depth exceeded", correlation_id=correlation_id)
        target = route_snapshot.get(triple)
        if target is None:
            if any(capability == triple[0] for provider in self.providers.values()
                   for (capability, _, _) in provider.operations):
                raise MMPError("CONTRACT_MISMATCH", "Capability exists with a different contract triple",
                               correlation_id=correlation_id)
            raise MMPError("DEPENDENCY_UNAVAILABLE", "No provider for exact triple", correlation_id=correlation_id)
        if self.providers.get(target.config.id) is not target:
            raise MMPError("DEPENDENCY_UNAVAILABLE", "Selected provider generation changed",
                           correlation_id=correlation_id)
        provider_id = target.config.id
        operation = target.operations.get(triple)
        if operation is None:
            raise MMPError("DEPENDENCY_UNAVAILABLE", "Selected provider lost the exact triple", correlation_id=correlation_id)
        grant = self.grants.get((caller, provider_id, operation["tool"]))
        if not grant or grant.effects != operation["effects"] \
                or not set(operation["permissions"]).issubset(grant.permissions):
            raise MMPError("PERMISSION_DENIED", "No matching grant", correlation_id=correlation_id)
        self._validate(triple[1], arguments, correlation_id)
        idempotency = operation["idempotency"]
        key = request.get("idempotencyKey")
        deduplicated = idempotency["mode"] == "deduplicated"
        target_pin = (provider_id, target.config.version, operation["tool"])
        retained_key = (caller, triple, key) if key else None
        dedup_key = retained_key if deduplicated else None
        if deduplicated and not key:
            raise MMPError("IDEMPOTENCY_CONFLICT", "idempotencyKey is required", correlation_id=correlation_id)
        if deduplicated and idempotency.get("restartPersistent"):
            raise MMPError("CONTRACT_MISMATCH", "Persistent deduplication is unsupported",
                           correlation_id=correlation_id)
        if retained_key:
            self._prune_dedup()
            retained = self.dedup.get(retained_key)
            if retained:
                if retained[0] != args_hash or retained[4] != target_pin:
                    raise MMPError("IDEMPOTENCY_CONFLICT", "Key retained for different arguments/provider",
                                   correlation_id=correlation_id)
                if retained[1] is not None:
                    return await self._await_duplicate(retained[1], retained[3], deadline, correlation_id, triple)
                if isinstance(retained[2], MMPError):
                    raise _rebind(retained[2], correlation_id)
                return {"outputContract": triple[2], "result": retained[2]}
        if dedup_key and len(self.dedup) >= self.max_dedup_entries:
            raise MMPError("INTERNAL", "Deduplication capacity is exhausted", retryable=True,
                           correlation_id=correlation_id)
        child = _Context(secrets.token_urlsafe(32), provider_id, target, operation, correlation_id, deadline,
                         depth_limit, [*chain, triple[0]],
                         {(dependency["capability"], dependency["inputContract"], dependency["outputContract"])
                          for dependency in target.descriptor["requires"]},
                         route_snapshot)
        self.contexts[child.token] = child
        future = asyncio.create_task(self._dispatch(target, operation, arguments, child, correlation_id))
        if context:
            context.children.add(future)
        if dedup_key:
            self.dedup[dedup_key] = (args_hash, future, None, time.monotonic() + IN_FLIGHT_TTL, target_pin)
        try:
            remaining = (deadline - _now_ms()) / 1000
            if remaining <= 0:
                future.cancel()
                await asyncio.gather(future, return_exceptions=True)
                raise MMPError("DEADLINE_EXCEEDED", "Deadline exceeded before dispatch",
                               correlation_id=correlation_id)
            result = await asyncio.wait_for(asyncio.shield(future), timeout=remaining)
            if dedup_key:
                self._terminal_dedup(dedup_key, args_hash, result, None, idempotency, target_pin)
            return {"outputContract": triple[2], "result": result}
        except MMPError as error:
            if dedup_key:
                self._terminal_dedup(dedup_key, args_hash, None, error, idempotency, target_pin)
            raise
        except asyncio.CancelledError:
            future.cancel()
            await asyncio.gather(future, return_exceptions=True)
            error = MMPError("CANCELLED", "Invocation was cancelled after dispatch", outcome="unknown",
                             correlation_id=correlation_id)
            if dedup_key:
                self._terminal_dedup(dedup_key, args_hash, None, error, idempotency, target_pin)
            raise error from None
        except TimeoutError as error:
            future.cancel()
            await asyncio.gather(future, return_exceptions=True)
            failure = MMPError("DEADLINE_EXCEEDED", "Invocation deadline exceeded", retryable=True,
                               outcome="unknown", correlation_id=correlation_id)
            if dedup_key:
                self._terminal_dedup(dedup_key, args_hash, None, failure, idempotency, target_pin)
            raise failure from error
        finally:
            for descendant in tuple(child.children):
                if not descendant.done():
                    descendant.cancel()
            if child.children:
                await asyncio.gather(*child.children, return_exceptions=True)
            if context:
                context.children.discard(future)
            self.contexts.pop(child.token, None)
            if dedup_key:
                retained = self.dedup.get(dedup_key)
                if retained and retained[1] is future:
                    self.dedup.pop(dedup_key, None)

    async def _await_duplicate(self, future: asyncio.Future, expiry: float, deadline: int,
                               correlation_id: str, triple: tuple[str, str, str]) -> dict[str, Any]:
        remaining = min(deadline, _now_ms() + int((expiry - time.monotonic()) * 1000))
        seconds = (remaining - _now_ms()) / 1000
        if seconds <= 0:
            raise MMPError("DEADLINE_EXCEEDED", "Deadline exceeded while waiting for a duplicate",
                           retryable=True, outcome="unknown", correlation_id=correlation_id)
        try:
            result = await asyncio.wait_for(asyncio.shield(future), timeout=seconds)
        except TimeoutError as error:
            raise MMPError("DEADLINE_EXCEEDED", "Deadline exceeded while waiting for a duplicate",
                           retryable=True, outcome="unknown", correlation_id=correlation_id) from error
        except asyncio.CancelledError as error:
            current = asyncio.current_task()
            if current is not None and current.cancelling():
                raise
            raise MMPError("CANCELLED", "Duplicate wait was cancelled", outcome="unknown",
                           correlation_id=correlation_id) from error
        except MMPError as error:
            raise _rebind(error, correlation_id) from error
        return {"outputContract": triple[2], "result": result}

    def _terminal_dedup(self, key: tuple[str, tuple[str, str, str], str], args_hash: str,
                        result: Any, error: MMPError | None, idempotency: dict[str, Any],
                        target_pin: tuple[str, str, str]) -> None:
        retention = idempotency.get("retentionSeconds", 1)
        self.dedup[key] = (args_hash, None, error if error is not None else result,
                           time.monotonic() + retention, target_pin)
        self._prune_dedup()

    def _prune_dedup(self) -> None:
        now = time.monotonic()
        for key, entry in tuple(self.dedup.items()):
            if entry[3] <= now:
                self.dedup.pop(key, None)

    async def _dispatch(self, target: _Admitted, operation: dict[str, Any], arguments: dict[str, Any],
                        ctx: _Context, correlation_id: str) -> dict[str, Any]:
        timeout = max(0.001, (ctx.deadline - _now_ms()) / 1000)
        try:
            result = await target.client.call_tool(
                operation["tool"], arguments, read_timeout_seconds=timeout,
                meta={CTX_META: ctx.token, GRANT_META: self.host_grants.get(target.config.id, "")})
            if result.is_error:
                raise self._downstream_error(result, correlation_id)
            content = getattr(result, "structured_content", None)
            if not isinstance(content, dict):
                raise MMPError("CONTRACT_MISMATCH", "Provider result lacks structuredContent object",
                               outcome="failed", correlation_id=correlation_id)
            self._bounded_canonical(content, correlation_id, "Output data")
            self._validate(operation["outputContract"], content, correlation_id)
        except MMPError:
            raise
        except asyncio.CancelledError:
            raise
        except TimeoutError as error:
            raise MMPError("DEADLINE_EXCEEDED", "Downstream provider deadline exceeded", retryable=True,
                           outcome="unknown", correlation_id=correlation_id) from error
        except Exception as error:
            raise MMPError("INTERNAL", "Downstream MCP request failed", outcome="unknown",
                           correlation_id=correlation_id) from error
        else:
            return content

    def _downstream_error(self, result: CallToolResult, correlation_id: str) -> MMPError:
        meta = getattr(result, "meta", None)
        payload = meta.get(ERR_META) if isinstance(meta, Mapping) else None
        if isinstance(payload, Mapping) and self._error_validator is not None:
            try:
                candidate = dict(payload)
            except (TypeError, ValueError):
                candidate = None
            if candidate is not None and not list(self._error_validator.iter_errors(candidate)):
                return MMPError(candidate["kind"], candidate["message"], retryable=candidate["retryable"],
                                outcome=candidate["outcome"], correlation_id=correlation_id)
        return MMPError("INTERNAL", "Downstream provider returned an operation error", outcome="unknown",
                        correlation_id=correlation_id)

    def _validate_invoke(self, request: Any, correlation_id: str) -> None:
        if self._invoke_validator is None:
            raise MMPError("INTERNAL", "Gateway schemas are not loaded", correlation_id=correlation_id)
        errors = list(self._invoke_validator.iter_errors(request))
        if errors:
            raise MMPError("CONTRACT_MISMATCH", f"Malformed invoke request at {errors[0].json_path}",
                           correlation_id=correlation_id)

    def _validate(self, contract_id: str, value: Any, correlation_id: str = "") -> None:
        contract = self.contracts.get(contract_id)
        if contract is None:
            raise MMPError("CONTRACT_MISMATCH", f"Unknown contract {contract_id}",
                           correlation_id=correlation_id)
        errors = list(contract[1].iter_errors(value))
        if errors:
            raise MMPError("CONTRACT_MISMATCH", f"Contract validation failed at {errors[0].json_path}",
                           correlation_id=correlation_id)

    def _bounded_canonical(self, value: Any, correlation_id: str, label: str) -> str:
        try:
            raw = _canonical(value)
        except (TypeError, ValueError, RecursionError) as error:
            raise MMPError("CONTRACT_MISMATCH", f"{label} is not finite JSON data",
                           correlation_id=correlation_id) from error
        try:
            size = len(raw.encode("utf-8"))
        except UnicodeEncodeError as error:
            raise MMPError("CONTRACT_MISMATCH", f"{label} is not valid UTF-8",
                           correlation_id=correlation_id) from error
        if size > self.max_message_bytes:
            raise MMPError("CONTRACT_MISMATCH", f"{label} exceeds the message bound",
                           correlation_id=correlation_id)
        if _depth(value) > self.max_data_depth:
            raise MMPError("CONTRACT_MISMATCH", f"{label} is too deep", correlation_id=correlation_id)
        return raw

    def _make_gateway_app(self):
        tool = mcp_types.Tool(
            name="mmp_invoke", description="Invoke a declared MMP dependency",
            inputSchema=self.invoke_schema, outputSchema=self.success_schema)

        async def on_list_tools(ctx, params):
            return mcp_types.ListToolsResult(tools=[tool])

        async def on_call_tool(ctx, params):
            correlation_id = uuid.uuid4().hex
            try:
                meta = ctx.meta
                if not isinstance(meta, Mapping):
                    raise TypeError("meta is not a mapping")
                token = meta.get(CTX_META)
                if not isinstance(token, str) or not token:
                    raise TypeError("context reference is absent")
                context = self.contexts.get(token)
            except (TypeError, ValueError):
                context = None
            if context is None:
                return _mcp_result(error=MMPError(
                    "PERMISSION_DENIED", "Unknown or malformed invocation context",
                    correlation_id=correlation_id))
            headers = _ctx_headers(ctx)
            if not self._credential_owns(context.caller, _bearer(headers.get("authorization"))):
                return _mcp_result(error=MMPError(
                    "PERMISSION_DENIED", "Caller credential does not own this context",
                    correlation_id=context.correlation_id))
            if params.name != "mmp_invoke":
                return _mcp_result(error=MMPError(
                    "DEPENDENCY_UNAVAILABLE", "Tool not found", correlation_id=context.correlation_id))
            arguments = params.arguments
            if not isinstance(arguments, dict):
                return _mcp_result(error=MMPError(
                    "CONTRACT_MISMATCH", "Invoke arguments must be an object",
                    correlation_id=context.correlation_id))
            try:
                result = await self._invoke(context.caller, arguments, context=context)
            except MMPError as error:
                if not error.correlation_id:
                    error.correlation_id = context.correlation_id
                return _mcp_result(error=error)
            except Exception:  # noqa: BLE001 - gateway request boundary
                return _mcp_result(error=MMPError(
                    "INTERNAL", "Invocation failed", outcome="unknown",
                    correlation_id=context.correlation_id))
            if self._success_validator is not None and list(self._success_validator.iter_errors(result)):
                return _mcp_result(error=MMPError(
                    "INTERNAL", "Gateway produced an invalid success result", outcome="unknown",
                    correlation_id=context.correlation_id))
            return _mcp_result(value=result)

        server = Server("MMP Gateway", version="0.1.0",
                        instructions="Authenticated MMP 0.1 dependency gateway",
                        on_list_tools=on_list_tools, on_call_tool=on_call_tool,
                        get_tool_input_schema=lambda name: self.invoke_schema if name == "mmp_invoke" else None)
        sdk_app = server.streamable_http_app(streamable_http_path="/mcp", json_response=True,
                                             stateless_http=True,
                                             max_request_body_size=self.max_message_bytes,
                                             host="127.0.0.1")

        async def authenticated(scope, receive, send):
            if scope["type"] != "http":
                await sdk_app(scope, receive, send)
                return
            headers = {_header_text(key).lower(): _header_text(value)
                       for key, value in scope.get("headers", [])}
            if not self._loopback_authority(headers.get("host")):
                await _plain_response(send, 403, "Forbidden")
                return
            origin = headers.get("origin")
            if origin is not None and origin.lower() not in self._allowed_origins():
                await _plain_response(send, 403, "Forbidden")
                return
            if not self._authenticated(headers.get("authorization")):
                await _plain_response(send, 401, "Unauthorized", [(b"www-authenticate", b"Bearer")])
                return
            await sdk_app(scope, receive, send)

        return authenticated

    def _loopback_authority(self, host: str | None) -> bool:
        if not host or self.authority is None:
            return False
        candidates = {self.authority}
        if self.address is not None and self.address[1] == 80:
            candidates.add(self.address[0])
        return host.strip().lower() in candidates

    def _allowed_origins(self) -> set[str]:
        if self.origin is None or self.address is None:
            return set()
        origins = {self.origin}
        if self.address[1] == 80:
            origins.add(f"http://{self.address[0]}")
        return origins

    def _authenticated(self, header: str | None) -> bool:
        token = _bearer(header)
        if not token:
            return False
        encoded = token.encode("utf-8")
        for credential in tuple(self.credentials.values()):
            if secrets.compare_digest(encoded, credential.encode("utf-8")):
                return True
        return False

    def _credential_owns(self, caller: str, token: str | None) -> bool:
        credential = self.credentials.get(caller)
        if not credential or not token:
            return False
        return secrets.compare_digest(token.encode("utf-8"), credential.encode("utf-8"))


def _read_schema(name: str) -> dict[str, Any]:
    raw = (SCHEMA_DIR / name).read_text(encoding="utf-8")
    value = json.loads(raw)
    if not isinstance(value, dict):
        raise TypeError(f"invalid packaged schema: {name}")
    return value


def _now_ms() -> int:
    return int(time.time() * 1000)


def _rebind(error: MMPError, correlation_id: str) -> MMPError:
    return MMPError(error.kind, error.message, retryable=error.retryable, outcome=error.outcome,
                    correlation_id=correlation_id)


def _header_text(value: Any) -> str:
    if isinstance(value, bytes):
        return value.decode("latin-1")
    return str(value)


def _ctx_headers(ctx: Any) -> dict[str, str]:
    candidate = getattr(ctx, "headers", None)
    if candidate is None:
        request = getattr(ctx, "request", None)
        candidate = getattr(request, "headers", None)
    if candidate is None:
        return {}
    try:
        return {_header_text(key).lower(): _header_text(value) for key, value in candidate.items()}
    except (AttributeError, TypeError, ValueError):
        return {}


def _bearer(header: str | None) -> str | None:
    if not header:
        return None
    scheme, separator, token = header.partition(" ")
    if not separator or scheme.lower() != "bearer":
        return None
    token = token.strip()
    return token or None


async def _plain_response(send, status: int, message: str,
                          extra: list[tuple[bytes, bytes]] | None = None) -> None:
    body = message.encode("utf-8")
    headers = [(b"content-type", b"text/plain; charset=utf-8"),
               (b"content-length", str(len(body)).encode("ascii"))]
    headers.extend(extra or [])
    await send({"type": "http.response.start", "status": status, "headers": headers})
    await send({"type": "http.response.body", "body": body})


def _relative_key(value: str) -> str:
    path = Path(value)
    if path.is_absolute():
        raise ValueError(f"provider launch entry must be relative: {value}")
    if any(part in ("", ".", "..") for part in path.parts):
        raise ValueError(f"provider launch entry is not canonical: {value}")
    return os.path.normcase(path.as_posix())


def _verify_launch_pin(provider: Provider, package_root: Path) -> None:
    if provider.args:
        key = _relative_key(provider.args[0])
        pinned = {_relative_key(rel) for rel in provider.files if not Path(rel).is_absolute()}
        if key not in pinned:
            raise ValueError("provider launch entry must be pinned in files")
        return
    try:
        relative = Path(provider.command).resolve().relative_to(package_root)
    except ValueError as error:
        raise ValueError("provider executable must be pinned in files") from error
    key = os.path.normcase(relative.as_posix())
    pinned = {_relative_key(rel) for rel in provider.files if not Path(rel).is_absolute()}
    if key not in pinned:
        raise ValueError("provider executable must be pinned in files")


def _verify_pinned_file(package_root: Path, rel: str, digest: str) -> None:
    candidate = Path(rel)
    if candidate.is_absolute():
        path = candidate
    else:
        path = package_root / candidate
    try:
        relative = path.relative_to(package_root)
    except ValueError as error:
        raise ValueError(f"provider artifact escapes pinned package root: {rel}") from error
    if any(part in ("", ".", "..") for part in relative.parts):
        raise ValueError(f"provider artifact escapes pinned package root: {rel}")
    cursor = package_root
    for part in relative.parts:
        cursor = cursor / part
        if cursor.is_symlink():
            raise ValueError(f"provider artifact traverses symlink: {rel}")
    resolved = path.resolve()
    if resolved != package_root and package_root not in resolved.parents:
        raise ValueError(f"provider artifact escapes pinned package root: {rel}")
    try:
        if not resolved.is_file() or hashlib.sha256(resolved.read_bytes()).hexdigest() != digest.lower():
            raise ValueError(f"provider artifact digest mismatch: {rel}")
    except OSError as error:
        raise ValueError(f"provider artifact is unreadable: {rel}") from error


def _canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def _mcp_result(*, value: dict[str, Any] | None = None, error: MMPError | None = None) -> CallToolResult:
    if error:
        data = {"isError": True, "content": [{"type": "text", "text": error.message}],
                "_meta": {ERR_META: error.as_dict()}}
    else:
        assert value is not None
        data = {"content": [{"type": "text", "text": json.dumps(value["result"], ensure_ascii=False)}],
                "structuredContent": value}
    return CallToolResult.model_validate(data)


def _depth(value: Any) -> int:
    maximum = 0
    stack: list[tuple[Any, int]] = [(value, 0)]
    while stack:
        node, level = stack.pop()
        if isinstance(node, dict):
            next_level = level + 1
            maximum = max(maximum, next_level)
            stack.extend((child, next_level) for child in node.values())
        elif isinstance(node, list):
            next_level = level + 1
            maximum = max(maximum, next_level)
            stack.extend((child, next_level) for child in node)
    return maximum


def _has_external_ref(value: Any) -> bool:
    if isinstance(value, dict):
        for keyword in ("$ref", "$dynamicRef"):
            reference = value.get(keyword)
            if isinstance(reference, str) and not reference.startswith("#"):
                return True
        return any(_has_external_ref(child) for child in value.values())
    if isinstance(value, list):
        return any(_has_external_ref(child) for child in value)
    return False
