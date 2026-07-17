import { defineTool } from 'eve/tools';
import { always } from 'eve/tools/approval';
import { CaseReceipt, PreparedGeneration } from '#lib/contracts.js';
import { callControlApi } from '#lib/control-api.js';

export default defineTool({
  description:
    'Create an idempotent, hash-bound source-only case in the durable Convex control plane.',
  inputSchema: PreparedGeneration,
  outputSchema: CaseReceipt,
  approval: always(),
  execute: (input, ctx) =>
    callControlApi({
      plane: 'generation',
      path: 'control/create-source-only-case',
      body: {
        projectId: input.generationInput.projectId,
        idempotencyKey: input.idempotencyKey,
        inputDigest: input.proposalDigest,
        input: input.generationInput,
      },
      outputSchema: CaseReceipt,
      signal: ctx.abortSignal,
    }),
});
