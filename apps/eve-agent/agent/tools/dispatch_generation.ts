import { defineTool } from 'eve/tools';
import { always } from 'eve/tools/approval';
import { JobReceipt, PreparedGeneration } from '#lib/contracts.js';
import { callControlApi } from '#lib/control-api.js';

export default defineTool({
  description:
    'Submit an approved, hash-bound source-only proposal to the existing NodeVideo media worker control API.',
  inputSchema: PreparedGeneration,
  outputSchema: JobReceipt,
  approval: always(),
  async execute(input, ctx) {
    const receipt = await callControlApi({
      plane: 'generation',
      path: 'jobs/submit',
      body: input,
      outputSchema: JobReceipt,
      signal: ctx.abortSignal,
    });
    if (receipt.traceId !== input.generationInput.traceId)
      throw new Error('Worker receipt crossed the trace boundary.');
    if (receipt.proposalDigest !== input.proposalDigest)
      throw new Error('Worker receipt is not bound to the approved proposal digest.');
    return receipt;
  },
  toModelOutput(output) {
    return {
      type: 'json',
      value: {
        jobId: output.jobId,
        traceId: output.traceId,
        status: output.status,
        proposalDigest: output.proposalDigest,
        freezeId: output.freezeId,
        freezeDigest: output.freezeDigest,
        artifactIds: output.artifactIds,
      },
    };
  },
});
