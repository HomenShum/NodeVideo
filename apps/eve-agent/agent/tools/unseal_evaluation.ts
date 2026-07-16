import { defineTool } from 'eve/tools';
import { always } from 'eve/tools/approval';
import { z } from 'zod';
import { OpaqueId, SHA256, UnsealReceipt } from '#lib/contracts.js';
import { callControlApi } from '#lib/control-api.js';

export default defineTool({
  description:
    'After freeze, request evaluator-only access to the hidden target using separate credentials.',
  inputSchema: z.object({ jobId: OpaqueId, freezeReceiptId: OpaqueId, hiddenTargetDigest: SHA256 }),
  outputSchema: UnsealReceipt,
  approval: always(),
  execute: (input, ctx) =>
    callControlApi({
      plane: 'evaluation',
      path: 'control/unseal-evaluation',
      body: input,
      outputSchema: UnsealReceipt,
      signal: ctx.abortSignal,
    }),
});
