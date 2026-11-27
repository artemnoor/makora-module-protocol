import { startHost } from "@artemnoor/mmp/host";

export async function start(config) {
  const host = await startHost(config);
  return {
    language: "typescript",
    gateway: host.gateway,
    call: (caller, invocation, options) => host.call(caller, invocation, options),
    // The shared cases always await select so both adapters have one contract.
    select: async (triple, id) => { host.select(triple, id); },
    close: () => host.close(),
  };
}
