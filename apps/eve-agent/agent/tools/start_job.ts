import { defineTool } from 'eve/tools';
import { always } from 'eve/tools/approval';
import { z } from 'zod';
import { OpaqueId, SHA256, StartJobReceipt } from '#lib/contracts.js';
import { callControlApi } from '#lib/control-api.js';

const Input = z.object({ caseId: OpaqueId, idempotencyKey: OpaqueId, inputDigest: SHA256 });
export default defineTool({
  description: 'Start the fixed durable NodeVideo stage graph for an admitted source-only case.',
  inputSchema: Input,
  outputSchema: StartJobReceipt,
  approval: always(),
  execute: (input, ctx) =>
    callControlApi({
      plane: 'generation',
      path: 'control/start-job',
      body: input,
      outputSchema: StartJobReceipt,
      signal: ctx.abortSignal,
    }),
});
