import { defineTool } from 'eve/tools';
import { always } from 'eve/tools/approval';
import { z } from 'zod';
import { AssetBinding, EvaluationReceipt, OpaqueId, SHA256 } from '#lib/contracts.js';
import { callControlApi } from '#lib/control-api.js';

const inputSchema = z.object({
  freezeId: OpaqueId,
  freezeDigest: SHA256,
  target: AssetBinding,
  metricProfile: z.literal('nodevideo.blind-proof.frames-v1'),
});

export default defineTool({
  description:
    'Evaluate an immutable, verified source-only freeze against a separately admitted held-out target. This cannot mutate or re-render the freeze.',
  inputSchema,
  outputSchema: EvaluationReceipt,
  approval: always(),
  async execute(input, ctx) {
    const receipt = await callControlApi({
      plane: 'evaluation',
      path: 'evaluations/submit',
      body: input,
      outputSchema: EvaluationReceipt,
      signal: ctx.abortSignal,
    });
    if (receipt.freezeId !== input.freezeId || receipt.freezeDigest !== input.freezeDigest)
      throw new Error('Evaluation receipt is not bound to the verified freeze.');
    return receipt;
  },
  toModelOutput(output) {
    return { type: 'json', value: output };
  },
});
