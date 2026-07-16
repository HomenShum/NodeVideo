import { defineTool } from 'eve/tools';
import { always } from 'eve/tools/approval';
import { z } from 'zod';
import { OpaqueId, RetryReceipt, StageName } from '#lib/contracts.js';
import { callControlApi } from '#lib/control-api.js';

export default defineTool({
  description: 'Retry one failed durable stage without replaying completed predecessor stages.',
  inputSchema: z.object({ jobId: OpaqueId, stage: StageName }),
  outputSchema: RetryReceipt,
  approval: always(),
  execute: (input, ctx) =>
    callControlApi({
      plane: 'generation',
      path: 'control/retry-stage',
      body: input,
      outputSchema: RetryReceipt,
      signal: ctx.abortSignal,
    }),
});
