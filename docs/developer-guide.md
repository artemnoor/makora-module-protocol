# MMP developer guide

[Русская версия](developer-guide.ru.md) · [Normative specification](../spec/0.1.0/overview.md)

MMP 0.1 gives applications a common way to connect independently versioned modules over MCP. Use it when an operation needs to call capabilities by contract or when an operator must be able to replace a provider without rewriting the consumer. A Host can compose conventional code, model-backed operations, external services and user-facing components using the same rules.

## Install the SDK

Build the package in the MMP checkout and install the resulting archive in an independent Node.js 22.13+ project:

```sh
npm ci
npm pack
```

```sh
npm init -y
npm install /path/to/artemnoor-mmp-0.1.0.tgz
```

| Import | Public surface |
| --- | --- |
| `@artemnoor/mmp` | Module SDK, wire identifiers, result helpers and TypeScript types |
| `@artemnoor/mmp/host` | `startHost`, `HostConfig`, policy types and the Reference Host |
| `@artemnoor/mmp/schemas/invoke` | Invoke JSON Schema. The other names are `module-descriptor`, `execution-context` and `error`. |

TypeScript uses the official MCP stdio server. Python can implement the wire using the official `mcp==2.3.0` SDK, as the template does.

## Define the contract and descriptor

1. Make a contract artifact containing a JSON Schema 2020-12 object in `schema`, a stable versioned `$id`, a `semantics` description and `fixtures.valid` / `fixtures.invalid` arrays. Record meanings, units and invariants that an application needs to interpret results. Assign a new ID for incompatible changes. The Reference Host supports local fragment schema references.
2. Publish a [module descriptor](../schemas/0.1.0/module-descriptor.schema.json) under `capabilities.extensions["io.github.artemnoor/mmp"].descriptor` in MCP `server/discover`. Give each operation its advertised tool name, capability, input and output contract IDs, effects, permissions, execution and idempotency fields.
3. Use the same schemas in `tools/list` and provide successful results as an object in `structuredContent`. Choose a capability namespace controlled by your publisher or shared naming authority. An alternative implementation can use its own package ID and version while retaining the same capability and contracts.

Copy a [starter](../templates/). Both echo modules use the same contract and are interchangeable through the Host. Choose a separate `$id` for an application-specific message type.

## Connect to the Reference Host

```js
import { startHost } from "@artemnoor/mmp/host";

const host = await startHost({
  catalog: [{ file: contractFile, digest: trustedContractSha256 }],
  packages: [{
    id: "org.example.typescript-echo",
    publisher: "org.example",
    version: "1.0.0",
    root: moduleDirectory,
    command: process.execPath,
    args: ["dist/server.js"],
    files: { "dist/server.js": trustedModuleSha256, "contract.json": trustedContractSha256 },
  }],
  knownPermissions: [],
  grants: [{
    caller: "host:app", target: "org.example.typescript-echo",
    tool: "echo", effects: "read-only", permissions: [],
  }],
});
try {
  const contract = "urn:mmp:starter:message:1.0.0";
  const result = await host.call("host:app", {
    capability: "org.example/echo", inputContract: contract, outputContract: contract,
    arguments: { message: "Hello" },
  });
  console.log(result.structuredContent);
} finally {
  await host.close();
}
```

Use absolute paths for `contractFile`, `moduleDirectory` and the runtime executable. Pin the exact bytes of the trusted artifacts before installation. For a Python module use its Python executable and entry script as the first argument. Register an independent second provider with its own identity and grant, then use `host.select(triple, moduleId)` before initiating a new root call. An already running call retains its provider selection.

## Call a dependency

Add a triple to the caller's `requires` and grant the caller's **module ID** access to the target operation in the Host. A TypeScript handler calls `call.invoke({ capability, inputContract, outputContract, arguments })`. Check `isError` before unwrapping `structuredContent.result`. In a Python or other MCP implementation, call the Gateway's `mmp_invoke` on a separate authenticated Streamable HTTP connection. Use the incoming context reference from `_meta["io.github.artemnoor/mmp-context"]`. It belongs to the active invocation and the authenticated module.

The Reference Host injects `MMP_GATEWAY` for the loopback URL, `MMP_CREDENTIAL` for the module's bearer credential and `MMP_HOST_GRANT` for protected inbound operations. The SDK's `createModule` options map these to `gateway`, `credential` and `hostGrant`. The reference protected-tool gate uses `_meta["io.github.artemnoor/mmp-grant"]` on the Host-to-module call. Alternate Hosts can use a different trusted protected-tool design. Keep credentials out of logs and use MCP cancellation for active work. [Wire calls](../spec/0.1.0/module-calls.md) · [Security](../spec/0.1.0/security.md)

## Add a user interface

Publish an MCP resource or configure a UI component in your Harness. The browser Lab discovers a `ui://` resource from `_meta.ui.resourceUri`, reads it with MCP and hosts the form in a sandboxed iframe. The application owns the allowed user actions and validates the form fields before issuing a new root call. Its pause state survives requests in the same process and session. [Lab guide](../demos/universality/README.md) · [MCP Apps](https://modelcontextprotocol.io/extensions/apps/overview)

## Implement a Host and check conformance

Implement against the [specification](../spec/0.1.0/overview.md), the four protocol schemas and upstream MCP. Use the following checks as a starting point:

| Boundary | Observable result |
| --- | --- |
| Admission | Reject the wrong revision or extension, missing descriptors, unknown grants, duplicate tool names and wrong artifact/schema digests. |
| Dispatch | Resolve exact triples, reject undeclared dependencies and mismatched callers, check inputs and outputs, and keep the provider pinned for the invocation. |
| Execution | Preserve upstream errors on the connection where they occur. Classify downstream failures, bound deadlines and depth, and handle cancellation and deduplication under the stated storage guarantees. |
| Interoperability | Complete ordinary MCP read-only access, nested cross-language calls, a replacement with the same triple and a full run without AI. |
| Trust | Enforce policy on the immediate authenticated caller. Bind local HTTP to loopback and validate the request origin. Isolate untrusted programs at the OS boundary. |

Run the [black-box tests](../conformance/), the [Spike](../spike/README.md) and `npm run verify:external` in an MMP checkout. The shipped suite targets the Reference Host and is a source of test vectors for a different implementation. Keep a record of results by protocol revision and expose any implementation-specific features, such as durable deduplication, explicitly.
