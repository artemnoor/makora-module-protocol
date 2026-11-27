export const HOST_LANGUAGES = ["typescript", "python"];

export async function createHost(language, config, options = {}) {
  if (language === "typescript") return (await import("./typescript.mjs")).start(config, options);
  if (language === "python") return (await import("./python.mjs")).start(config, options);
  throw new Error(`Unknown conformance Host language: ${language}`);
}
