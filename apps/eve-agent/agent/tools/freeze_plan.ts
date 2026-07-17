import { defineTool } from 'eve/tools';
import { always } from 'eve/tools/approval';
import { z } from 'zod';
import { FreezeReceipt, OpaqueId, SHA256 } from '#lib/contracts.js';
import { callControlApi } from '#lib/control-api.js';

const Input = z.object({
  jobId: OpaqueId,
  planArtifactId: OpaqueId,
  planDigest: SHA256,
  renderArtifactId: OpaqueId,
  renderDigest: SHA256,
  generationReadLogDigest: SHA256,
});
export default defineTool({
  description: 'Seal the exact plan, render, and closed generation read log before evaluation.',
  inputSchema: Input,
  outputSchema: FreezeReceipt,
  approval: always(),
  execute: (input, ctx) =>
    callControlApi({
      plane: 'generation',
      path: 'control/freeze-plan',
      body: input,
      outputSchema: FreezeReceipt,
      signal: ctx.abortSignal,
    }),
});
