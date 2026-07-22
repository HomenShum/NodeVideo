import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const rootRealPath = await realpath(root);
const proofDirectory = path.join(root, 'fixtures/proof/nodekit-caseflow-consumer');
const verdictPath = path.join(root, 'fixtures/proof/nodekit-caseflow-consumer-verdict.json');

const sourcePaths = [
  'convex/convex.config.ts',
  'convex/nodeVideoCaseflow.ts',
  'convex/schema.ts',
  'docs/nodekit-caseflow-consumer.md',
  'package-lock.json',
  'package.json',
  'scripts/quality/prepare-nodekit-package.mjs',
  'scripts/quality/prove-nodekit-caseflow-consumer.mjs',
  'tests/nodekit-caseflow-conformance.test.ts',
  'tests/nodekit-caseflow-proof.test.ts',
  'vendor/homenshum-nodekit-0.2.1.tgz',
  'vendor/nodekit-package-manifest.json',
];

const commands = [
  ['npm ci', 'npm', ['ci']],
  ['npm run lint', 'npm', ['run', 'lint']],
  ['npm run typecheck', 'npm', ['run', 'typecheck']],
  [
    'npx tsc -p convex/tsconfig.json --noEmit --pretty false',
    'npx',
    ['tsc', '-p', 'convex/tsconfig.json', '--noEmit', '--pretty', 'false'],
  ],
  [
    'npx vitest run tests/nodekit-caseflow-conformance.test.ts --reporter=verbose',
    'npx',
    ['vitest', 'run', 'tests/nodekit-caseflow-conformance.test.ts', '--reporter=verbose'],
  ],
  ['npm run build', 'npm', ['run', 'build']],
];

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function contentHash(value) {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

async function containedPath(relativePath) {
  if (path.isAbsolute(relativePath))
    throw new Error(`evidence path must be relative: ${relativePath}`);
  const absolutePath = await realpath(path.resolve(root, relativePath));
  if (absolutePath !== rootRealPath && !absolutePath.startsWith(`${rootRealPath}${path.sep}`)) {
    throw new Error(`evidence escapes consumer root: ${relativePath}`);
  }
  return absolutePath;
}

function git(args, encoding = 'utf8') {
  return execFileSync('git', args, { cwd: root, encoding });
}

const dirtySource = git(['status', '--porcelain=v1', '-z', '--', ...sourcePaths], 'buffer');
if (dirtySource.length !== 0) {
  throw new Error(
    'consumer source and immutable package must be committed before generating the local proof receipt',
  );
}

await mkdir(proofDirectory, { recursive: true });
const commandResults = [];
async function executeCommand([label, executable, args]) {
  const packageManagerCli = path.join(
    path.dirname(process.execPath),
    'node_modules',
    'npm',
    'bin',
    executable === 'npx' ? 'npx-cli.js' : 'npm-cli.js',
  );
  const platformExecutable =
    executable === 'npm' || executable === 'npx' ? process.execPath : executable;
  const executableArgs =
    executable === 'npm' || executable === 'npx' ? [packageManagerCli, ...args] : args;
  const result = spawnSync(platformExecutable, executableArgs, {
    cwd: root,
    encoding: 'utf8',
    shell: false,
  });
  const log = [
    `$ ${label}`,
    '',
    result.stdout ?? '',
    result.stderr ?? '',
    `exitCode=${String(result.status)}`,
  ].join('\n');
  const logName = `${String(commandResults.length + 1).padStart(2, '0')}-${label
    .replaceAll(/[^a-z0-9]+/giu, '-')
    .replaceAll(/^-|-$/gu, '')}.log`;
  const relativeLogPath = path.posix.join('fixtures/proof/nodekit-caseflow-consumer', logName);
  await writeFile(path.join(root, relativeLogPath), log, 'utf8');
  const logBytes = await readFile(path.join(root, relativeLogPath));
  commandResults.push({
    command: label,
    evidencePath: relativeLogPath,
    evidenceSha256: sha256(logBytes),
    passed: result.status === 0,
  });
  if (result.status !== 0) {
    throw new Error(`${label} failed; inspect ${relativeLogPath}`);
  }
  return commandResults.at(-1);
}

for (const command of commands) {
  await executeCommand(command);
}

const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const packageSpec = packageJson.dependencies['@homenshum/nodekit'];
if (packageSpec !== 'file:vendor/homenshum-nodekit-0.2.1.tgz') {
  throw new Error(`unexpected NodeKit package spec: ${String(packageSpec)}`);
}
const packageManifest = JSON.parse(
  await readFile(path.join(root, 'vendor/nodekit-package-manifest.json'), 'utf8'),
);
const { manifestHash, ...packageManifestBody } = packageManifest;
if (contentHash(packageManifestBody) !== manifestHash) {
  throw new Error('NodeKit package manifest content hash is invalid');
}
const packageLock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
const lockedNodeKit = packageLock.packages?.['node_modules/@homenshum/nodekit'];
if (lockedNodeKit?.integrity !== packageManifest.package.integrity) {
  throw new Error('installed NodeKit lockfile integrity does not match the packed candidate');
}
const installedPackagePaths = [
  'dist/client/index.js',
  'dist/component/caseflow.js',
  'dist/component/_generated/component.d.ts',
  'dist/convex-test.js',
  'package.json',
];
const installedPackageFiles = [];
for (const relativePath of installedPackagePaths) {
  const bytes = await readFile(path.join(root, 'node_modules/@homenshum/nodekit', relativePath));
  installedPackageFiles.push({ path: relativePath, sha256: sha256(bytes) });
}

const evidence = [];
for (const relativePath of sourcePaths) {
  const absolutePath = await containedPath(relativePath);
  evidence.push({ path: relativePath, sha256: sha256(await readFile(absolutePath)) });
}
for (const result of commandResults) {
  evidence.push({ path: result.evidencePath, sha256: result.evidenceSha256 });
}
if (new Set(evidence.map((entry) => entry.path)).size !== evidence.length) {
  throw new Error('duplicate evidence paths are not allowed');
}
const packageEvidence = evidence.find(
  (entry) => entry.path === 'vendor/homenshum-nodekit-0.2.1.tgz',
);
if (packageEvidence?.sha256 !== packageManifest.package.sha256) {
  throw new Error('packed NodeKit tarball does not match its immutable manifest');
}

const implementationCommit = git(['rev-parse', 'HEAD']).trim();
const branch = git(['branch', '--show-current']).trim();
const verdictBody = {
  assertions: {
    actualPackedComponentInstalled: true,
    authenticatedProductionProof: false,
    cancelAndFailSafeExplicit: true,
    deployed: false,
    exceptionRecoveryPreservesCheckpoint: true,
    fullRegressionSuite: false,
    hostOwnedAuthAndScope: true,
    idempotentRetries: true,
    localComponentRuntime: true,
    nodeVideoDomainLifecycle: true,
    ownerIsolation: true,
    published: false,
    receiptIntegrity: true,
    staleProposalFailedClosed: true,
  },
  commands: commandResults,
  consumer: {
    branch,
    implementationCommit,
    repository: 'https://github.com/HomenShum/NodeVideo.git',
    sourceManifestHash: contentHash(evidence.filter((entry) => sourcePaths.includes(entry.path))),
  },
  evidence,
  externalProofRequired: [
    'authenticated production deployment using this exact package tarball',
    'fresh-user browser screenshots and export/reopen proof',
    'independent ProofLoop verification of the deployed revision',
  ],
  generatedAt: new Date().toISOString(),
  nodekit: {
    packageIntegrity: packageManifest.package.integrity,
    installedPackageFiles,
    lockfileIntegrity: lockedNodeKit.integrity,
    packageManifestHash: packageManifest.manifestHash,
    packagePath: 'vendor/homenshum-nodekit-0.2.1.tgz',
    packageSha1: packageManifest.package.sha1,
    packageSha256: packageManifest.package.sha256,
    packageSpec,
    packageVersion: packageManifest.package.version,
    sourceCommit: packageManifest.source.commit,
    sourceHash: packageManifest.source.distributableSourceHash,
    sourceWorkingTreeCleanAtPackTime: packageManifest.source.workingTreeClean,
    supportedImports: [
      '@homenshum/nodekit/convex-caseflow',
      '@homenshum/nodekit/convex.config.js',
      '@homenshum/nodekit/test',
    ],
  },
  schemaVersion: 'nodevideo.nodekit-caseflow-consumer-verdict/v2',
  status: 'passed_local_only',
};
const verdict = { ...verdictBody, evidenceHash: contentHash(verdictBody) };
await writeFile(verdictPath, `${JSON.stringify(verdict, null, 2)}\n`, 'utf8');

// The full suite includes the verdict verifier. Run it against the valid
// preliminary receipt, then bind its complete log into the final receipt.
const regression = await executeCommand(['npm test', 'npm', ['test']]);
evidence.push({ path: regression.evidencePath, sha256: regression.evidenceSha256 });
verdictBody.assertions.fullRegressionSuite = true;
verdictBody.generatedAt = new Date().toISOString();
const finalVerdict = { ...verdictBody, evidenceHash: contentHash(verdictBody) };
await writeFile(verdictPath, `${JSON.stringify(finalVerdict, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify(finalVerdict, null, 2)}\n`);
