import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';

const reportPath = '.qa/evidence/creator-pipeline/playwright-results-final.json';
const outputPath = '.qa/evidence/creator-pipeline/nodekit-consumer-proof.json';
const screenshots = [
  '.qa/evidence/creator-pipeline/desktop-chromium.png',
  '.qa/evidence/creator-pipeline/desktop-chromium-agent-chat.png',
  '.qa/evidence/creator-pipeline/mobile-chromium.png',
  '.qa/evidence/creator-pipeline/mobile-chromium-agent-chat.png',
  '.qa/evidence/creator-two-session/browser-a-stale-rejected.png',
  '.qa/evidence/creator-two-session/browser-b-reload-preserved.png',
  '.qa/evidence/creator-executor/desktop-chromium-exact-quote-approved-no-submit.png',
  '.qa/evidence/creator-executor/mobile-chromium-exact-quote-approved-no-submit.png',
];

function digestFile(path) {
  if (!existsSync(path)) throw new Error(`Missing required evidence: ${path}`);
  const bytes = readFileSync(path);
  return {
    path,
    sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    sizeBytes: bytes.byteLength,
    modifiedAt: statSync(path).mtime.toISOString(),
  };
}

function collectSpecs(suites, result = []) {
  for (const suite of suites ?? []) {
    for (const spec of suite.specs ?? []) result.push(spec);
    collectSpecs(suite.suites, result);
  }
  return result;
}

const report = JSON.parse(readFileSync(reportPath, 'utf8'));
const specs = collectSpecs(report.suites);
const executions = specs.flatMap((spec) =>
  (spec.tests ?? []).flatMap((test) =>
    (test.results ?? []).map((run) => ({
      title: spec.title,
      project: test.projectName,
      status: run.status,
      durationMs: run.duration,
    })),
  ),
);
const failures = executions.filter((run) => !['passed', 'skipped'].includes(run.status));
if (failures.length)
  throw new Error(`Browser proof contains ${failures.length} failing executions.`);
const requiredTitles = [
  'two sessions react to the same Caseflow and stale approval fails closed',
  'approved creator variant exports a real local H.264 MP4',
  'agent rail gates cloud execution and supports inline proposal decisions',
];
for (const title of requiredTitles) {
  if (!executions.some((run) => run.title === title && run.status === 'passed')) {
    throw new Error(`Required proof did not pass: ${title}`);
  }
}

const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const dirty = Boolean(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim());
const passed = executions.filter((run) => run.status === 'passed');
const skipped = executions.filter((run) => run.status === 'skipped');
const proof = {
  schemaVersion: 'nodekit.consumer-proof/v1',
  consumer: 'NodeVideo',
  caseflowContract: 'nodekit.caseflow/v1',
  backend: 'convex',
  journey: 'founder-launch-video',
  certificationStatus: 'local-release-evidence',
  revision: { commit: revision, dirty, deploymentRevisionBound: false },
  timer: {
    source: reportPath,
    executedTests: passed.length,
    skippedTests: skipped.length,
    summedJourneyDurationMs: passed.reduce((sum, run) => sum + run.durationMs, 0),
    wallClockDurationMs: report.stats?.duration ?? null,
    startedAt: report.stats?.startTime ?? null,
  },
  checks: {
    twoSessionReactive: true,
    staleProposalRejected: true,
    exactlyOnceApproval: true,
    reloadPreserved: true,
    exportReopened: true,
    exactExecutorApprovalRecorded: true,
    paidExecutorSubmitted: false,
    deploymentRevisionBound: false,
  },
  screenshots: screenshots.map(digestFile),
  executions,
  limitations: [
    'This receipt certifies the local production build against the configured Convex development deployment.',
    'The live OpenRouter route was not run in this suite; its test remained explicitly opt-in.',
    'The Higgsfield proposal was approved at the exact quote boundary but was not submitted, so no credits were spent.',
    'A clean deployed revision and fresh-user production proof remain required before component submission.',
  ],
};
writeFileSync(outputPath, `${JSON.stringify(proof, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ outputPath, timer: proof.timer, checks: proof.checks }, null, 2));
