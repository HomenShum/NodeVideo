import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { JobReceipt, OpaqueId } from '#lib/contracts.js';
import { callControlApi } from '#lib/control-api.js';

export default defineTool({
  description:
    "Read a NodeVideo generation job's bounded status and verified artifact identifiers.",
  inputSchema: z.object({ jobId: OpaqueId, traceId: OpaqueId }),
  outputSchema: JobReceipt,
  async execute(input, ctx) {
    const receipt = await callControlApi({
      plane: 'generation',
      path: 'jobs/status',
      body: input,
      outputSchema: JobReceipt,
      signal: ctx.abortSignal,
    });
    if (receipt.jobId !== input.jobId || receipt.traceId !== input.traceId)
      throw new Error('Worker status crossed the requested job or trace boundary.');
    return receipt;
  },
  toModelOutput(output) {
    return {
      type: 'json',
      value: {
        jobId: output.jobId,
        status: output.status,
        freezeId: output.freezeId,
        freezeDigest: output.freezeDigest,
        artifactIds: output.artifactIds,
      },
    };
  },
});
