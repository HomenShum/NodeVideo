import { defineTool } from 'eve/tools';
import { always } from 'eve/tools/approval';
import { z } from 'zod';
import { CancellationReceipt, OpaqueId } from '#lib/contracts.js';
import { callControlApi } from '#lib/control-api.js';

export default defineTool({
  description: 'Cancel an unfinished NodeVideo job and all unfinished durable stages.',
  inputSchema: z.object({ jobId: OpaqueId }),
  outputSchema: CancellationReceipt,
  approval: always(),
  execute: (input, ctx) =>
    callControlApi({
      plane: 'generation',
      path: 'control/cancel-job',
      body: input,
      outputSchema: CancellationReceipt,
      signal: ctx.abortSignal,
    }),
});
