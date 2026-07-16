import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { canonicalJson, sha256 } from '#lib/canonical.js';
import { GenerationInput, PreparedGeneration } from '#lib/contracts.js';

export default defineTool({
  description:
    'Validate and hash a target-blind NodeVideo generation request. This schema deliberately has no target field.',
  inputSchema: GenerationInput,
  outputSchema: PreparedGeneration,
  execute(input) {
    const proposalDigest = sha256(input);
    const suffix = proposalDigest.slice('sha256:'.length, 'sha256:'.length + 24);
    return {
      schemaVersion: 'nodevideo.source-only-job/v1' as const,
      proposalId: `proposal:${suffix}`,
      proposalDigest,
      idempotencyKey: `source-only:${input.projectId}:${suffix}`,
      generationInput: JSON.parse(canonicalJson(input)),
      isolation: {
        targetAccess: 'denied' as const,
        evaluatorCredentialPresent: false as const,
        networkAccess: false as const,
      },
    };
  },
  toModelOutput(output) {
    return {
      type: 'json',
      value: {
        proposalId: output.proposalId,
        proposalDigest: output.proposalDigest,
        idempotencyKey: output.idempotencyKey,
        isolation: output.isolation,
      },
    };
  },
});
