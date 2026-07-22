import { execFile } from 'node:child_process';
import { mkdir, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  benchmarkRoot,
  evidenceRoot,
  loadAllSources,
  readJson,
  sha256,
  writeJson,
} from './creatorbench-io.mjs';
import { clipSrtEntries, parseSrt, wordsFromSrtEntries } from './creatorbench-srt.mjs';

const execFileAsync = promisify(execFile);
const mediaRoot = resolve(evidenceRoot, 'media');
const indexRoot = resolve(evidenceRoot, 'media-indexes');
const transcriptRoot = resolve(evidenceRoot, 'transcripts');
const vault = await readJson(resolve(evidenceRoot, 'acquisition-vault.json'));
const sources = await loadAllSources();
const vaultById = new Map(vault.records.map((record) => [record.id, record]));
const speechSources = sources.filter((source) => source.corpusTier === 'speech-long-form');

await mkdir(indexRoot, { recursive: true });
await mkdir(transcriptRoot, { recursive: true });

function collectionUrl(mediaUrl) {
  const url = new URL(mediaUrl);
  url.pathname = `${dirname(url.pathname).replaceAll('\\', '/')}/collection.json`;
  return url.toString();
}

async function fetchTranscript(record) {
  const collectionResponse = await fetch(collectionUrl(record.mediaUrl), {
    headers: {
      'user-agent': 'NodeVideo-CreatorBench/1.0 (rights-governed research benchmark)',
    },
  });
  if (!collectionResponse.ok) throw new Error(`collection HTTP ${collectionResponse.status}`);
  const collection = await collectionResponse.json();
  const srtUrl = collection
    .map((value) => String(value).replace(/^http:\/\//u, 'https://'))
    .find((value) => /\.srt$/iu.test(value));
  if (!srtUrl) throw new Error('no official SRT sidecar');
  const transcriptResponse = await fetch(srtUrl, {
    headers: {
      'user-agent': 'NodeVideo-CreatorBench/1.0 (rights-governed research benchmark)',
    },
  });
  if (!transcriptResponse.ok) throw new Error(`transcript HTTP ${transcriptResponse.status}`);
  return { srtUrl, text: await transcriptResponse.text() };
}

const indexed = [];
const missing = [];
for (const source of speechSources) {
  const record = vaultById.get(source.id);
  if (!record) throw new Error(`Missing acquisition record for ${source.id}.`);
  const sourcePath = resolve(mediaRoot, record.localCacheKey);
  const indexPath = resolve(indexRoot, `${source.id}.json`);
  const transcriptPath = resolve(transcriptRoot, `${source.id}.json`);
  try {
    const transcript = await fetchTranscript(record);
    const transcriptSha256 = `sha256:${sha256(transcript.text)}`;
    try {
      const [cachedIndex, cachedTranscript] = await Promise.all([
        readJson(indexPath),
        readJson(transcriptPath),
      ]);
      const hasOfficialTranscriptTool = cachedIndex.provenance?.tools?.some(
        (tool) => tool.id === 'nasa.official-srt-sidecar',
      );
      if (
        cachedTranscript.srtSha256 === transcriptSha256 &&
        hasOfficialTranscriptTool &&
        Array.isArray(cachedIndex.speech?.words)
      ) {
        indexed.push({
          sourceId: source.id,
          split: source.split,
          wordCount: cachedIndex.speech.words.length,
          quoteCount: cachedIndex.semantics?.quotes?.length ?? 0,
          silenceCount: cachedIndex.speech.silenceRegions?.length ?? 0,
          indexSha256: `sha256:${sha256(JSON.stringify(cachedIndex))}`,
        });
        continue;
      }
    } catch {
      // Missing or stale cache falls through to deterministic re-indexing.
    }
    await execFileAsync(
      'python',
      [
        resolve(benchmarkRoot, '../../scripts/analysis/build_media_index.py'),
        sourcePath,
        '--asset-id',
        source.id,
        '--transcription',
        'none',
        '--output',
        indexPath,
      ],
      { timeout: 10 * 60_000, windowsHide: true, maxBuffer: 4_000_000 },
    );
    const index = await readJson(indexPath);
    const sourceOffsetMs = Number(record.sourceClipStartSeconds ?? 5) * 1_000;
    const entries = clipSrtEntries(
      parseSrt(transcript.text),
      sourceOffsetMs,
      index.technical.durationMs,
    );
    const words = wordsFromSrtEntries(entries);
    index.speech = {
      ...(index.speech ?? { silenceRegions: [] }),
      words,
      fillers: words
        .filter((word) => /^(?:um+|uh+|erm|like)$/iu.test(word.text.replace(/[,.!?]/gu, '')))
        .map((word) => ({ ...word, confidence: 1 })),
    };
    index.semantics.quotes = entries.map((entry, quoteIndex) => ({
      id: `quote:${quoteIndex}`,
      ...entry,
      scores: {
        clarity: Math.min(1, entry.text.length / 90),
        hook: /\b(?:why|how|never|first|problem|built|because)\b/iu.test(entry.text) ? 0.9 : 0.55,
        novelty: 0.5,
        selfContained: /[.!?]$/u.test(entry.text) ? 0.85 : 0.6,
      },
    }));
    index.provenance.tools.push({
      id: 'nasa.official-srt-sidecar',
      version: '1.0.0',
      parametersHash: `sha256:${sha256(`${transcript.srtUrl}:${sourceOffsetMs}:${index.technical.durationMs}`)}`,
    });
    index.provenance.limitations = [
      ...(index.provenance.limitations ?? []).filter(
        (limitation) => limitation !== 'transcription disabled by request',
      ),
      'Official caption timing is segment-level; word timing is uniformly interpolated inside each caption segment.',
    ];
    await writeJson(transcriptPath, {
      schemaVersion: 'nodevideo.creatorbench-transcript-sidecar/v1',
      sourceId: source.id,
      sourceOffsetMs,
      durationMs: index.technical.durationMs,
      srtUrl: transcript.srtUrl,
      srtSha256: transcriptSha256,
      entries,
    });
    await writeJson(indexPath, index);
    indexed.push({
      sourceId: source.id,
      split: source.split,
      wordCount: words.length,
      quoteCount: entries.length,
      silenceCount: index.speech.silenceRegions.length,
      indexSha256: `sha256:${sha256(JSON.stringify(index))}`,
    });
  } catch (error) {
    await Promise.all([
      unlink(indexPath).catch(() => undefined),
      unlink(transcriptPath).catch(() => undefined),
    ]);
    missing.push({
      sourceId: source.id,
      split: source.split,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

const splitCounts = Object.fromEntries(
  ['development', 'public-test', 'private-heldout', 'adversarial'].map((split) => [
    split,
    indexed.filter((record) => record.split === split).length,
  ]),
);
const receipt = {
  schemaVersion: 'nodevideo.creatorbench-speech-index-receipt/v1',
  benchmarkVersion: (await readJson(resolve(benchmarkRoot, 'config/domains.json')))
    .benchmarkVersion,
  generatedAt: new Date().toISOString(),
  sourceCount: speechSources.length,
  indexedCount: indexed.length,
  missingTranscriptCount: missing.length,
  splitCounts,
  totalWords: indexed.reduce((sum, record) => sum + record.wordCount, 0),
  totalQuotes: indexed.reduce((sum, record) => sum + record.quoteCount, 0),
  totalSilenceRegions: indexed.reduce((sum, record) => sum + record.silenceCount, 0),
  transcriptTextPublished: false,
  privateLocatorPublished: false,
  publicIndexes: indexed.filter((record) => record.split !== 'private-heldout'),
  missing: missing.filter((record) => record.split !== 'private-heldout'),
};
await writeJson(resolve(benchmarkRoot, 'receipts/speech-index-receipt.json'), receipt);
await writeJson(resolve(evidenceRoot, 'speech-index-private-receipt.json'), {
  ...receipt,
  indexed,
  missing,
});
console.log(JSON.stringify(receipt, null, 2));
