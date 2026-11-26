import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

export const revision = "2026-07-28";
export const extension = "io.github.artemnoor/mmp";
export const callContext = "io.github.artemnoor/mmp-context";
export const operationError = "io.github.artemnoor/mmp-error";
export const report = "urn:mmp:example:report:1.0.0";
export const task = "urn:mmp:example:task:1.0.0";

export async function connect(transport) {
  const client = new Client({ name: "mmp-spike", version: "0.1.0" }, {
    versionNegotiation: { mode: { pin: revision } },
  });
  try {
    await client.connect(transport);
    return client;
  } catch (error) {
    await client.close();
    throw error;
  }
}

export function gatewayTransport(url, credential) {
  return new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { authorization: `Bearer ${credential}` } },
  });
}

export function structured(value) {
  return { structuredContent: value, content: [{ type: "text", text: JSON.stringify(value) }] };
}

export function failure(kind, correlationId, outcome = "not-started") {
  return {
    isError: true,
    _meta: { [operationError]: { kind, message: kind, retryable: false, correlationId, outcome } },
    content: [{ type: "text", text: kind }],
  };
}
