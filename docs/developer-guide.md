# MMP developer guide

[Русская версия](developer-guide.ru.md) · [Normative specification](../spec/0.1.0/overview.md)

MMP 0.1 gives applications a common way to connect independently versioned modules over MCP. Use it when an operation needs to call capabilities by contract or when an operator must be able to replace a provider without rewriting the consumer. A Host can compose conventional code, model-backed operations, external services and user-facing components using the same rules.

## Install the SDK

Once MMP 0.1.0 is published, install it from the public npm registry in your own Node.js 22.13+ project:

```sh
npm install @artemnoor/mmp@0.1.0
```

Alternatively, build the archive in a checkout and install it in a separate Node.js 22.13+ project:

```sh
# in the MMP checkout
npm ci
npm pack
```

```sh
# in the separate project
npm install /path/to/artemnoor-mmp-0.1.0.tgz
```

The archive fallback is a local install; it does not publish the package. A registry install uses `https://registry.npmjs.org/`; the consumer check below does not fall back to a local archive if that request fails.

| Import | Public surface |
| --- | --- |
| `@artemnoor/mmp` | Module SDK, `revision`, `profile`, `extension`, `readProtocolSchema`, wire identifiers, result helpers and TypeScript types |
| `@artemnoor/mmp/host` | `startHost`, `HostConfig`, policy types and the Reference Host |
| `@artemnoor/mmp/schemas/invoke` | Invoke JSON Schema. `module-descriptor`, `execution-context` and `error` are also exported. |

The package is the only MMP import a consumer needs. A TypeScript module also imports the official MCP stdio server, `@modelcontextprotocol/server@2.4.0`, as the starter does; it does not import files from the MMP checkout. This minimal module uses the same public surface as the [TypeScript starter](../templates/typescript/server.ts) and the `contract.json` artifact described in the next section:

```ts
import { readFileSync } from "node:fs";
import { createModule, structured, type Descriptor, type JsonObject } from "@artemnoor/mmp";
import { serveStdio } from "@modelcontextprotocol/server/stdio";

const { schema } = JSON.parse(
  readFileSync(new URL("../contract.json", import.meta.url), "utf8"),
) as { schema: JsonObject & { $id: string } };

const descriptor: Descriptor = {
  id: "org.example.echo",
  publisher: "org.example",
  version: "1.0.0",
  mmpVersion: "0.1.0",
  description: "Return a message unchanged",
  requires: [],
  operations: [{
    capability: "org.example/echo",
    inputContract: schema.$id,
    outputContract: schema.$id,
    tool: "echo",
    effects: "read-only",
    permissions: [],
    execution: "sync",
    idempotency: { mode: "natural" },
  }],
};

serveStdio(() => createModule(descriptor, {
  echo: { inputSchema: schema, outputSchema: schema, run: input => structured(input) },
}, {
  gateway: process.env.MMP_GATEWAY,
  credential: process.env.MMP_CREDENTIAL,
  hostGrant: process.env.MMP_HOST_GRANT,
}));
```

Compile it to `dist/server.js` with the installed compiler, for example `npx tsc server.ts --target ES2023 --module NodeNext --strict --outDir dist`. TypeScript uses the official MCP stdio server. Python can implement the wire using the official `mcp==2.3.0` SDK, as the template does.

Verify the installed package from outside the checkout:

```sh
node experiments/release/sdk-consumer.mjs /path/to/artemnoor-mmp-0.1.0.tgz
node experiments/release/sdk-consumer.mjs @artemnoor/mmp@0.1.0
```

The script creates an empty temporary project, installs the package and the pinned compiler, compiles its TypeScript module under strict settings against the installed declarations, imports and compares all four schema exports, then starts the Reference Host and calls a fresh ESM module. It exits nonzero on failure, imports nothing from the checkout, never publishes and never falls back from the public registry to a tarball. [Script](../experiments/release/sdk-consumer.mjs)

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

Implement against the [specification](../spec/0.1.0/overview.md), the four protocol schemas and upstream MCP. The [Host implementer guide](host-implementer.md) covers the language-neutral boundaries and records compatibility evidence separately. Use the following checks as a starting point:

| Boundary | Observable result |
| --- | --- |
| Admission | Reject the wrong revision or extension, missing descriptors, unknown grants, duplicate tool names and wrong artifact/schema digests. |
| Dispatch | Resolve exact triples, reject undeclared dependencies and mismatched callers, check inputs and outputs, and keep the provider pinned for the invocation. |
| Execution | Preserve upstream errors on the connection where they occur. Classify downstream failures, bound deadlines and depth, and handle cancellation and deduplication under the stated storage guarantees. |
| Interoperability | Complete ordinary MCP read-only access, nested cross-language calls, a replacement with the same triple and a full run without AI. |
| Trust | Enforce policy on the immediate authenticated caller. Bind local HTTP to loopback and validate the request origin. Isolate untrusted programs at the OS boundary. |

From an MMP checkout run the shared black-box suite against both Hosts:

```sh
npm run verify:hosts
npm run verify:external:hosts
```

`verify:hosts` runs the same cases through a thin TypeScript adapter around `startHost` and a bridge to the [Python Host](https://github.com/artemnoor/makora-module-protocol/blob/main/python-host/README.md); a missing Python Host or dependency fails the run. `verify:external:hosts` runs the same JSON graphs and modules through both Hosts in an isolated workspace. The [shared cases](https://github.com/artemnoor/makora-module-protocol/blob/main/conformance/README.md) use only the normative wire shapes and public Host API, never private Host internals. Also run the [Spike](../spike/README.md) and `npm run verify:external`. Current results are recorded in the [release report](release-0.1.0.md); keep your own record by protocol revision and expose any implementation-specific features, such as durable deduplication, explicitly.
