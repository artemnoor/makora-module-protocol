import { createHost, HOST_LANGUAGES } from "./host-adapters/index.mjs";

export const language = process.env.MMP_CONFORMANCE_HOST ?? "typescript";
if (!HOST_LANGUAGES.includes(language)) {
  throw new Error(`MMP_CONFORMANCE_HOST must be one of ${HOST_LANGUAGES.join(", ")}`);
}

export const label = name => `${name} [${language}]`;

export function start(config) {
  return createHost(language, config);
}

export async function hostRejects(promise) {
  let host;
  try {
    host = await promise;
  } catch (error) {
    if (error?.code === "HOST_UNAVAILABLE") throw error;
    return error;
  }
  await host.close();
  throw new Error("Expected the Host to reject the configuration");
}
