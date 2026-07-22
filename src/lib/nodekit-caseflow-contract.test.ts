import { describe, expect, test } from 'vitest';

import {
  CASEFLOW_SCHEMA_VERSIONS,
  createMemoryCaseflow,
} from '@homenshum/nodekit/src/lib/caseflow.mjs';

describe('shared NodeKit Caseflow contract', () => {
  test('consumes the canonical lifecycle and conflict semantics from NodeKit', () => {
    expect(CASEFLOW_SCHEMA_VERSIONS).toMatchObject({
      case: 'nodekit.case/v1',
      run: 'nodekit.run/v1',
      artifact: 'nodekit.artifact/v1',
      proposal: 'nodekit.proposal/v1',
      approval: 'nodekit.approval/v1',
      receipt: 'nodekit.receipt/v1',
    });

    const runtime = createMemoryCaseflow({ clock: () => '2026-07-21T00:00:00.000Z' });
    const work = runtime.createCase({
      title: 'Founder launch video',
      primaryJob: 'Create launch outputs',
    });
    const run = runtime.startRun({
      caseId: work.caseId,
      stages: [
        { id: 'intake', label: 'Add source', owner: 'user' },
        { id: 'review', label: 'Review proposal', owner: 'user' },
      ],
    });
    const artifact = runtime.createArtifact({
      caseId: work.caseId,
      runId: run.runId,
      kind: 'video-campaign',
      title: 'Canonical video',
      content: { version: 1 },
    });
    const winner = runtime.createProposal({
      artifactId: artifact.artifactId,
      baseVersion: 1,
      patch: { version: 2, variant: 'local-a' },
      rationale: 'Source-grounded launch cut',
    });
    const stale = runtime.createProposal({
      artifactId: artifact.artifactId,
      baseVersion: 1,
      patch: { version: 2, variant: 'local-b' },
      rationale: 'Alternative launch cut',
    });
    expect(
      runtime.decideProposal({ proposalId: winner.proposalId, decision: 'accepted' }).proposal
        .status,
    ).toBe('accepted');
    expect(
      runtime.decideProposal({ proposalId: stale.proposalId, decision: 'accepted' }).proposal
        .status,
    ).toBe('conflicted');
    expect(runtime.snapshot().artifacts[0].canonicalVersion).toBe(2);
  });
});
