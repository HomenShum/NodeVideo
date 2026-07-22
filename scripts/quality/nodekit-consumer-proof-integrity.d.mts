export interface PackageCandidateManifest {
  generatedAt: string;
  manifestHash: string;
  package: {
    bytes: number;
    filename: string;
    integrity: string;
    name: string;
    sha1: string;
    sha256: string;
    shasum: string;
    version: string;
  };
  schemaVersion: string;
  source: {
    commit: string;
    distributableSourceHash: string;
    workingTreeClean: boolean;
  };
}

export function contentHash(value: unknown): string;

export function assertExactPackageProvenance(options: {
  manifest: unknown;
  packageBytes: Uint8Array;
  packagePath: string;
  expectedName: string;
  expectedVersion: string;
}): {
  manifestHash: string;
  packageSha1: string;
  packageSha256: string;
  sourceCommit: string;
  sourceHash: string;
};

export function assertCommittedProofInputs(options: {
  root: string;
  relativePaths: string[];
}): {
  commit: string;
  entries: Array<{ gitBlob: string; mode: string; path: string; sha256: string }>;
};
