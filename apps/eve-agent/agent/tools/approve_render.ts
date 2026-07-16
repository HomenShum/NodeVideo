import { defineTool } from 'eve/tools';
import { always } from 'eve/tools/approval';
import { z } from 'zod';
import { ApprovalReceipt, OpaqueId } from '#lib/contracts.js';
import { callControlApi } from '#lib/control-api.js';

export default defineTool({
  description: 'Approve the reviewed preview so the immutable freeze stage may begin.',
  inputSchema: z.object({ jobId: OpaqueId, approverRef: OpaqueId }),
  outputSchema: ApprovalReceipt,
  approval: always(),
  execute: (input, ctx) =>
    callControlApi({
      plane: 'generation',
      path: 'control/approve-render',
      body: input,
      outputSchema: ApprovalReceipt,
      signal: ctx.abortSignal,
    }),
});
