import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { JobSnapshot, OpaqueId } from '#lib/contracts.js';
import { callControlApi } from '#lib/control-api.js';

export default defineTool({
  description: 'Read durable stage, event, and artifact state for one NodeVideo job.',
  inputSchema: z.object({ jobId: OpaqueId }),
  outputSchema: JobSnapshot,
  execute: (input, ctx) =>
    callControlApi({
      plane: 'generation',
      path: 'control/read-job',
      body: input,
      outputSchema: JobSnapshot,
      signal: ctx.abortSignal,
    }),
});
