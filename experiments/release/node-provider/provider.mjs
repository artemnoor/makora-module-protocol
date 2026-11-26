import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createModule, structured } from '@artemnoor/mmp';
import { serveStdio } from '@modelcontextprotocol/server/stdio';

const contractId = 'urn:mmp:independent:reading:1.0.0';
const contractPath = process.env.LAB_CONTRACT;

if (!contractPath) {
  throw new Error('LAB_CONTRACT must point to a JSON contract envelope');
}

const envelope = JSON.parse(readFileSync(resolve(contractPath), 'utf8'));
const contractSchema = envelope?.schema;

if (
  !contractSchema ||
  typeof contractSchema !== 'object' ||
  contractSchema.$id !== contractId ||
  contractSchema.type !== 'object'
) {
  throw new Error(`LAB_CONTRACT must contain schema $id ${contractId}`);
}

const descriptor = {
  id: 'org.independent.node',
  publisher: 'org.independent',
  version: '1.0.0',
  mmpVersion: '0.1.0',
  description: 'Independent Node provider for reading classification and normalization.',
  requires: [
    {
      capability: 'org.independent/annotate',
      inputContract: contractId,
      outputContract: contractId,
    },
  ],
  operations: [
    {
      capability: 'org.independent/classify',
      inputContract: contractId,
      outputContract: contractId,
      tool: 'classify',
      permissions: [],
      effects: 'read-only',
      execution: 'sync',
      idempotency: { mode: 'natural' },
    },
    {
      capability: 'org.independent/normalize',
      inputContract: contractId,
      outputContract: contractId,
      tool: 'normalize',
      permissions: [],
      effects: 'read-only',
      execution: 'sync',
      idempotency: { mode: 'natural' },
    },
  ],
};

function appendNote(value, note) {
  return { ...structuredClone(value), notes: [...value.notes, note] };
}

const handlers = {
  classify: {
    inputSchema: contractSchema,
    outputSchema: contractSchema,
    run(args, call) {
      const classified = appendNote(
        {
          ...args,
          severity: args.amount >= 60 ? 'review' : 'normal',
        },
        'classified',
      );

      if (process.env.LAB_NESTED !== '1') {
        return structured(classified);
      }

      return call.invoke({
        capability: 'org.independent/annotate',
        inputContract: contractId,
        outputContract: contractId,
        arguments: classified,
      }).then((gatewayResult) => {
        if (gatewayResult.isError) {
          return gatewayResult;
        }

        const nested = gatewayResult.structuredContent;
        if (
          !nested ||
          typeof nested !== 'object' ||
          nested.outputContract !== contractId ||
          !nested.result ||
          typeof nested.result !== 'object' ||
          Array.isArray(nested.result)
        ) {
          throw new Error('Gateway returned an invalid annotate success envelope');
        }

        return structured(nested.result);
      });
    },
  },
  normalize: {
    inputSchema: contractSchema,
    outputSchema: contractSchema,
    run(args) {
      return structured(
        appendNote({ ...args, source: args.source.trim() }, 'normalized'),
      );
    },
  },
};

const server = createModule(descriptor, handlers, {
  gateway: process.env.MMP_GATEWAY,
  credential: process.env.MMP_CREDENTIAL,
  hostGrant: process.env.MMP_HOST_GRANT,
});

serveStdio(() => server, { onerror: (error) => console.error(error) });
