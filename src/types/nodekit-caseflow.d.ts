declare module '@homenshum/nodekit/src/lib/caseflow.mjs' {
  export const CASEFLOW_SCHEMA_VERSIONS: Record<string, string>;

  export function createMemoryCaseflow(options?: { clock?: () => string }): {
    createCase(input: Record<string, unknown>): { caseId: string };
    startRun(input: Record<string, unknown>): { runId: string };
    createArtifact(input: Record<string, unknown>): { artifactId: string };
    createProposal(input: Record<string, unknown>): { proposalId: string };
    decideProposal(input: Record<string, unknown>): { proposal: { status: string } };
    snapshot(): { artifacts: Array<{ canonicalVersion: number }> };
  };
}
