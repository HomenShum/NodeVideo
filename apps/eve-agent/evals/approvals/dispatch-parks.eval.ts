import { defineEval } from 'eve/evals';

export default defineEval({
  async test(t) {
    await t.send(
      `Submit this already prepared source-only proposal and wait for my approval: ${JSON.stringify(
        {
          schemaVersion: 'nodevideo.source-only-job/v1',
          proposalId: 'proposal:0123456789abcdef01234567',
          proposalDigest: `sha256:${'a'.repeat(64)}`,
          idempotencyKey: 'source-only:project-1:0123456789abcdef01234567',
          generationInput: {
            schemaVersion: 'nodevideo.source-only-job-request/v1',
            projectId: 'project-1',
            traceId: 'trace-1',
            choreographyReference: { assetId: 'reference-1', sha256: `sha256:${'1'.repeat(64)}` },
            song: {
              assetId: 'song-1',
              sha256: `sha256:${'2'.repeat(64)}`,
              excerptStartMs: 0,
              excerptEndMs: 20000,
              rightsAttestationId: 'rights-1',
            },
            takes: [
              { assetId: 'take-1', sha256: `sha256:${'3'.repeat(64)}` },
              { assetId: 'take-2', sha256: `sha256:${'4'.repeat(64)}` },
            ],
            objective: 'Create a movement- and beat-aligned vertical edit.',
          },
          isolation: {
            targetAccess: 'denied',
            evaluatorCredentialPresent: false,
            networkAccess: false,
          },
        },
      )}`,
    );
    t.requireInputRequest({ toolName: 'dispatch_generation' });
    t.calledTool('dispatch_generation', { status: 'pending', count: 1 });
  },
});
