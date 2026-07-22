import { resolve } from 'node:path';
import {
  benchmarkRoot,
  evidenceRoot,
  loadAllSources,
  readJson,
  sha256,
  writeJson,
} from './creatorbench-io.mjs';

function hamming(left, right) {
  if (!left || !right || left.length !== right.length) return Number.POSITIVE_INFINITY;
  let distance = 0;
  for (let index = 0; index < left.length; index += 1) {
    const xor = Number.parseInt(left[index], 16) ^ Number.parseInt(right[index], 16);
    distance += xor.toString(2).replaceAll('0', '').length;
  }
  return distance;
}

const sources = await loadAllSources();
const acquisitionVault = await readJson(resolve(evidenceRoot, 'acquisition-vault.json'));
const evidenceBySource = new Map(acquisitionVault.records.map((record) => [record.id, record]));
const findings = [];
const creatorsBySplit = new Map();
const groupsBySplit = new Map();
for (const source of sources) {
  const creatorSplits = creatorsBySplit.get(source.creatorOwnerId) ?? new Set();
  creatorSplits.add(source.split);
  creatorsBySplit.set(source.creatorOwnerId, creatorSplits);
  const groupSplits = groupsBySplit.get(source.relatedSourceGroupId) ?? new Set();
  groupSplits.add(source.split);
  groupsBySplit.set(source.relatedSourceGroupId, groupSplits);
}
for (const [creatorId, splits] of creatorsBySplit) {
  if (splits.size > 1)
    findings.push({ kind: 'creator-split-leakage', creatorId, splits: [...splits] });
}
for (const [relatedSourceGroup, splits] of groupsBySplit) {
  if (splits.size > 1)
    findings.push({ kind: 'source-group-split-leakage', relatedSourceGroup, splits: [...splits] });
}

for (let leftIndex = 0; leftIndex < sources.length; leftIndex += 1) {
  const left = sources[leftIndex];
  for (let rightIndex = leftIndex + 1; rightIndex < sources.length; rightIndex += 1) {
    const right = sources[rightIndex];
    const leftEvidence = evidenceBySource.get(left.id);
    const rightEvidence = evidenceBySource.get(right.id);
    const exactMedia = left.sourceSha256 === right.sourceSha256;
    const sameAudio =
      leftEvidence?.audioFingerprint &&
      leftEvidence.audioFingerprint !== 'no-audio' &&
      leftEvidence.audioFingerprint === rightEvidence?.audioFingerprint;
    const visualDistance = hamming(
      leftEvidence?.visualPerceptualHash,
      rightEvidence?.visualPerceptualHash,
    );
    if (exactMedia || sameAudio || visualDistance <= 4) {
      findings.push({
        kind: exactMedia
          ? 'exact-media-duplicate'
          : sameAudio
            ? 'audio-duplicate'
            : 'visual-near-duplicate',
        leftId: left.id,
        rightId: right.id,
        leftSplit: left.split,
        rightSplit: right.split,
        visualDistance: Number.isFinite(visualDistance) ? visualDistance : null,
        crossesSplit: left.split !== right.split,
      });
    }
  }
}

const blocking = findings.filter(
  (finding) =>
    ['creator-split-leakage', 'source-group-split-leakage'].includes(finding.kind) ||
    finding.crossesSplit,
);
const receipt = {
  schemaVersion: 'nodevideo.creatorbench-deduplication-receipt.v1',
  benchmarkVersion: 'creatorbench-v1.1',
  generatedAt: new Date().toISOString(),
  sourceCount: sources.length,
  creatorCount: new Set(sources.map((source) => source.creatorOwnerId)).size,
  visualAlgorithm: 'first-frame-dhash-64',
  visualHammingThreshold: 4,
  audioAlgorithm: 'sha256-normalized-mono-pcm-8khz-six-seconds',
  findings,
  blockingFindingCount: blocking.length,
  passed: blocking.length === 0,
  catalogSetSha256: `sha256:${sha256(
    sources
      .map((source) => `${source.id}:${source.sourceSha256}:${source.split}`)
      .sort()
      .join('\n'),
  )}`,
};
await writeJson(resolve(benchmarkRoot, 'receipts/deduplication-receipt.json'), receipt);
console.log(
  JSON.stringify(
    {
      sourceCount: receipt.sourceCount,
      findings: findings.length,
      blocking: blocking.length,
      passed: receipt.passed,
    },
    null,
    2,
  ),
);
if (blocking.length > 0) process.exitCode = 1;
