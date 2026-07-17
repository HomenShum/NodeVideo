#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const AUDIO_PRODUCTION_AUDIT_SCHEMA_VERSION = 'nodevideo.audio-production-audit.v1';

export function auditAudioProduction({ candidatePath, referencePath, artifactId }) {
  const candidate = decodeMono(candidatePath);
  const reference = decodeMono(referencePath);
  const count = Math.min(candidate.length, reference.length);
  if (count < SAMPLE_RATE) throw new Error('Audio comparison requires at least one shared second.');
  const candidateSlice = candidate.subarray(0, count);
  const referenceSlice = reference.subarray(0, count);
  const offset = estimateEnvelopeOffset(candidateSlice, referenceSlice);
  const aligned = align(candidateSlice, referenceSlice, offset.offsetSamples);
  const candidateRms = rms(aligned.candidate);
  const referenceRms = rms(aligned.reference);
  const gainDbToReference = 20 * Math.log10((referenceRms + 1e-12) / (candidateRms + 1e-12));
  return {
    schemaVersion: AUDIO_PRODUCTION_AUDIT_SCHEMA_VERSION,
    id: artifactId,
    inputs: {
      candidate: { sha256: sha256(candidatePath) },
      reference: { sha256: sha256(referencePath) },
    },
    analysis: {
      sampleRateHz: SAMPLE_RATE,
      comparedDurationMs: Math.round((aligned.candidate.length / SAMPLE_RATE) * 1_000),
      estimatedOffsetMs: Math.round((offset.offsetSamples / SAMPLE_RATE) * 1_000),
      envelopeCorrelation: round(offset.correlation, 6),
      waveformCorrelation: round(correlation(aligned.candidate, aligned.reference), 6),
      candidateIntegratedLufs: integratedLufs(candidatePath),
      referenceIntegratedLufs: integratedLufs(referencePath),
      candidateGainDbToReference: round(gainDbToReference, 3),
    },
    interpretationBoundary:
      'Signal measurements are observations. Loudness, timing, and mastering intent remain hypotheses until owner-confirmed.',
  };
}

const SAMPLE_RATE = 8_000;

function decodeMono(path) {
  const result = spawnSync(
    'ffmpeg',
    [
      '-v',
      'error',
      '-i',
      resolve(path),
      '-vn',
      '-ac',
      '1',
      '-ar',
      String(SAMPLE_RATE),
      '-f',
      'f32le',
      '-',
    ],
    { encoding: null, maxBuffer: 256 * 1024 * 1024 },
  );
  if (result.status !== 0) throw new Error(`ffmpeg audio decode failed: ${result.stderr}`);
  return new Float32Array(
    result.stdout.buffer,
    result.stdout.byteOffset,
    Math.floor(result.stdout.byteLength / Float32Array.BYTES_PER_ELEMENT),
  );
}

function integratedLufs(path) {
  const result = spawnSync(
    'ffmpeg',
    [
      '-hide_banner',
      '-nostats',
      '-i',
      resolve(path),
      '-vn',
      '-af',
      'ebur128=peak=true',
      '-f',
      'null',
      '-',
    ],
    { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
  );
  const matches = [...result.stderr.matchAll(/I:\s+(-?\d+(?:\.\d+)?)\s+LUFS/g)];
  if (matches.length === 0) throw new Error('ffmpeg did not report integrated LUFS.');
  return Number(matches.at(-1)[1]);
}

function estimateEnvelopeOffset(candidate, reference) {
  const bucketSize = Math.floor(SAMPLE_RATE / 100);
  const envelope = (samples) => {
    const values = new Float64Array(Math.floor(samples.length / bucketSize));
    for (let i = 0; i < values.length; i += 1) {
      let sum = 0;
      for (let j = 0; j < bucketSize; j += 1) sum += Math.abs(samples[i * bucketSize + j]);
      values[i] = sum / bucketSize;
    }
    return values;
  };
  const a = envelope(candidate);
  const b = envelope(reference);
  let best = { offsetSamples: 0, correlation: -1 };
  for (let offsetBuckets = -200; offsetBuckets <= 200; offsetBuckets += 1) {
    const aligned = align(a, b, offsetBuckets);
    const value = correlation(aligned.candidate, aligned.reference);
    if (value > best.correlation) {
      best = { offsetSamples: offsetBuckets * bucketSize, correlation: value };
    }
  }
  return best;
}

function align(candidate, reference, candidateOffset) {
  const candidateStart = Math.max(0, candidateOffset);
  const referenceStart = Math.max(0, -candidateOffset);
  const length = Math.min(candidate.length - candidateStart, reference.length - referenceStart);
  return {
    candidate: candidate.subarray(candidateStart, candidateStart + length),
    reference: reference.subarray(referenceStart, referenceStart + length),
  };
}

function rms(values) {
  let sum = 0;
  for (const value of values) sum += value * value;
  return Math.sqrt(sum / values.length);
}

function correlation(a, b) {
  const count = Math.min(a.length, b.length);
  let sumA = 0;
  let sumB = 0;
  for (let i = 0; i < count; i += 1) {
    sumA += a[i];
    sumB += b[i];
  }
  const meanA = sumA / count;
  const meanB = sumB / count;
  let covariance = 0;
  let varianceA = 0;
  let varianceB = 0;
  for (let i = 0; i < count; i += 1) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    covariance += da * db;
    varianceA += da * da;
    varianceB += db * db;
  }
  return covariance / Math.sqrt(Math.max(varianceA * varianceB, 1e-24));
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function round(value, digits) {
  return Number(value.toFixed(digits));
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--') || index + 1 >= argv.length)
      throw new Error(`Invalid argument: ${key}`);
    options[key.slice(2)] = argv[index + 1];
    index += 1;
  }
  for (const key of ['candidate', 'reference', 'out']) {
    if (!options[key]) throw new Error(`--${key} is required.`);
  }
  return options;
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const result = auditAudioProduction({
    candidatePath: options.candidate,
    referencePath: options.reference,
    artifactId: options['artifact-id'] ?? 'audio-audit.production',
  });
  writeFileSync(resolve(options.out), `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(
    `${JSON.stringify({ out: resolve(options.out), analysis: result.analysis })}\n`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
