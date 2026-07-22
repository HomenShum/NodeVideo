import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { collectNasaSvsCandidates } from './sources/nasa-svs.mjs';

const execFileAsync = promisify(execFile);
const root = resolve(import.meta.dirname, '..', '..');
const configPath = resolve(root, 'benchmarks/creatorbench-v1/config/domains.json');
const config = JSON.parse(await readFile(configPath, 'utf8'));
const evidenceRoot = resolve(root, '.qa/evidence/creatorbench-v1');
const mediaRoot = resolve(evidenceRoot, 'media');
const catalogRoot = resolve(root, 'benchmarks/creatorbench-v1/catalog');
const receiptRoot = resolve(root, 'benchmarks/creatorbench-v1/receipts');
const target = Number(
  process.argv.find((arg) => arg.startsWith('--target='))?.split('=')[1] ?? config.targetClips,
);
const downloadMedia = !process.argv.includes('--metadata-only');
const overwrite = process.argv.includes('--overwrite');
const cachedOnly = process.argv.includes('--cached-only');
const discoverOnly = process.argv.includes('--discover-only');
const providers = new Set(
  (
    process.argv.find((arg) => arg.startsWith('--providers='))?.split('=')[1] ??
    'wikimedia,nasa-svs'
  )
    .split(',')
    .map((provider) => provider.trim())
    .filter(Boolean),
);
const acquisitionFailures = [];

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const stableNumber = (value) => Number.parseInt(sha256(value).slice(0, 8), 16);
const stripHtml = (value = '') =>
  value
    .replace(/<[^>]+>/gu, ' ')
    .replace(/&(?:nbsp|#160);/gu, ' ')
    .replace(/&amp;/gu, '&')
    .replace(/&#39;|&apos;/gu, "'")
    .replace(/&quot;/gu, '"')
    .replace(/\s+/gu, ' ')
    .trim();
const normalizeCreator = (value) =>
  stripHtml(value)
    .toLowerCase()
    .replace(/[^a-z\d]+/gu, '-');

await mkdir(mediaRoot, { recursive: true });
await mkdir(catalogRoot, { recursive: true });
await mkdir(receiptRoot, { recursive: true });

const wait = (milliseconds) => new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
let lastSearchAt = 0;

async function wikimediaSearch(query, offset) {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    origin: '*',
    generator: 'search',
    gsrsearch: `filetype:video ${query}`,
    gsrnamespace: '6',
    gsrlimit: '50',
    gsrinfo: 'totalhits',
    prop: 'videoinfo',
    viprop: 'url|mime|size|duration|derivatives|extmetadata|sha1',
  });
  if (offset) params.set('gsroffset', offset);
  const elapsed = Date.now() - lastSearchAt;
  if (elapsed < 600) await wait(600 - elapsed);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    lastSearchAt = Date.now();
    const response = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, {
      headers: {
        'user-agent': 'NodeVideo-CreatorBench/1.0 (https://github.com/HomenShum/NodeVideo)',
      },
    });
    if (response.ok) return response.json();
    if (response.status !== 429 && response.status < 500) {
      throw new Error(`Wikimedia search failed: ${response.status}`);
    }
    const retryAfter = Number(response.headers.get('retry-after') ?? 0);
    await wait(Math.max(retryAfter * 1_000, 1_500 * 2 ** attempt));
  }
  throw new Error('Wikimedia search remained rate-limited after bounded retries.');
}

function selectDerivative(info) {
  const derivatives = Array.isArray(info.derivatives) ? info.derivatives : [];
  const video = derivatives.filter(
    (item) => item.src && /video\//u.test(item.type ?? 'video/webm'),
  );
  const preferred = video
    .filter((item) => (item.width ?? 0) >= 240 && (item.width ?? 0) <= 640)
    .sort((left, right) => {
      const leftMp4 = /mp4/u.test(left.type ?? left.src) ? 1 : 0;
      const rightMp4 = /mp4/u.test(right.type ?? right.src) ? 1 : 0;
      return rightMp4 - leftMp4 || (left.width ?? 9999) - (right.width ?? 9999);
    })[0];
  return preferred?.src ?? info.url;
}

function candidateFromPage(page, domain) {
  const info = page.videoinfo?.[0];
  if (
    !info ||
    !info.url ||
    !String(info.mime ?? '').startsWith('video/') ||
    !Number.isFinite(info.duration) ||
    info.duration < config.clipDurationSeconds
  )
    return undefined;
  const metadata = info.extmetadata ?? {};
  const license = stripHtml(metadata.LicenseShortName?.value);
  if (!config.allowedLicenses.includes(license)) return undefined;
  const attribution = stripHtml(
    metadata.Artist?.value || metadata.Credit?.value || 'Unknown creator',
  );
  if (!attribution || attribution === 'Unknown creator') return undefined;
  const creatorKey = normalizeCreator(attribution);
  const sourcePage = `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title.replaceAll(' ', '_'))}`;
  return {
    title: page.title.replace(/^File:/u, ''),
    domain: domain.id,
    query: domain.query,
    sourceUrl: info.url,
    acquisitionUrl: selectDerivative(info),
    sourcePage,
    originalSha1: info.sha1 ?? null,
    sourceDurationSeconds: info.duration,
    sourceMimeType: info.mime,
    attribution,
    creatorKey,
    creatorId: `creator:${sha256(creatorKey).slice(0, 16)}`,
    license,
    licenseUrl: stripHtml(metadata.LicenseUrl?.value),
    permittedBenchmarkUses: ['evaluation', 'derived-six-second-clip', 'public-metadata'],
    permittedRedistribution: true,
    relatedSourceGroup: `commons:${page.pageid}`,
  };
}

async function collectWikimediaCandidates(desiredTarget) {
  const bySource = new Map();
  const creatorCounts = new Map();
  const perDomainTarget = Math.max(1, Math.ceil((desiredTarget * 1.35) / config.domains.length));
  for (const domain of config.domains) {
    let offset;
    let accepted = 0;
    for (let pageIndex = 0; pageIndex < 6 && accepted < perDomainTarget; pageIndex += 1) {
      const payload = await wikimediaSearch(domain.query, offset);
      const pages = Object.values(payload.query?.pages ?? {});
      for (const page of pages) {
        const candidate = candidateFromPage(page, domain);
        if (!candidate || bySource.has(candidate.sourceUrl)) continue;
        const creatorCount = creatorCounts.get(candidate.creatorId) ?? 0;
        if (creatorCount >= config.maximumClipsPerCreator) continue;
        bySource.set(candidate.sourceUrl, candidate);
        creatorCounts.set(candidate.creatorId, creatorCount + 1);
        accepted += 1;
        if (accepted >= perDomainTarget) break;
      }
      offset = payload.continue?.gsroffset;
      if (!offset) break;
    }
  }
  const fallbackQueries = [
    ['general-documentary', 'documentary video'],
    ['general-motion', 'moving people video'],
    ['general-demonstration', 'demonstration video'],
    ['general-event', 'public event video'],
    ['general-outdoor', 'outdoor activity video'],
    ['general-indoor', 'indoor activity video'],
    ['general-archive', 'historical public domain film'],
    ['general-education', 'educational video'],
  ];
  for (const [id, query] of fallbackQueries) {
    if (bySource.size >= desiredTarget + 40) break;
    let offset;
    for (let pageIndex = 0; pageIndex < 8 && bySource.size < desiredTarget + 40; pageIndex += 1) {
      const payload = await wikimediaSearch(query, offset);
      for (const page of Object.values(payload.query?.pages ?? {})) {
        const candidate = candidateFromPage(page, { id, query });
        if (!candidate || bySource.has(candidate.sourceUrl)) continue;
        const creatorCount = creatorCounts.get(candidate.creatorId) ?? 0;
        if (creatorCount >= config.maximumClipsPerCreator) continue;
        bySource.set(candidate.sourceUrl, candidate);
        creatorCounts.set(candidate.creatorId, creatorCount + 1);
      }
      offset = payload.continue?.gsroffset;
      if (!offset) break;
    }
  }
  const candidates = [...bySource.values()];
  candidates.sort(
    (left, right) =>
      stableNumber(`${left.domain}:${left.sourceUrl}`) -
      stableNumber(`${right.domain}:${right.sourceUrl}`),
  );
  return candidates.slice(0, Math.min(candidates.length, desiredTarget + 40));
}

async function readExistingVault() {
  try {
    const vault = JSON.parse(
      await readFile(resolve(evidenceRoot, 'acquisition-vault.json'), 'utf8'),
    );
    const records = Array.isArray(vault.records) ? vault.records : [];
    const valid = [];
    for (const record of records) {
      try {
        const bytes = await readFile(resolve(mediaRoot, record.localCacheKey));
        if (bytes.length > 0) valid.push(record);
      } catch {
        // A stale vault locator is not a usable cached acquisition.
      }
    }
    return valid;
  } catch {
    return [];
  }
}

function enforceCreatorLimit(candidates, seedRecords = []) {
  const counts = new Map();
  for (const record of seedRecords) {
    counts.set(record.creatorId, (counts.get(record.creatorId) ?? 0) + 1);
  }
  return candidates.filter((candidate) => {
    const count = counts.get(candidate.creatorId) ?? 0;
    if (count >= config.maximumClipsPerCreator) return false;
    counts.set(candidate.creatorId, count + 1);
    return true;
  });
}

async function collectCandidates(desiredTarget, existingRecords) {
  const collected = [];
  if (providers.has('nasa-svs')) {
    collected.push(
      ...(await collectNasaSvsCandidates({
        domains: config.domains,
        target: desiredTarget + 20,
        maximumClipsPerCreator: config.maximumClipsPerCreator,
      })),
    );
  }
  if (providers.has('wikimedia')) {
    collected.push(...(await collectWikimediaCandidates(desiredTarget + 20)));
  }
  const existingLocators = new Set(
    existingRecords.flatMap((record) => [record.sourceUrl, record.mediaUrl]).filter(Boolean),
  );
  const unique = new Map();
  for (const candidate of collected) {
    if (
      existingLocators.has(candidate.sourceUrl) ||
      existingLocators.has(candidate.sourcePage) ||
      unique.has(candidate.sourceUrl)
    ) {
      continue;
    }
    unique.set(candidate.sourceUrl, candidate);
  }
  return enforceCreatorLimit([...unique.values()], existingRecords);
}

function run(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      ...options,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    child.stdout?.on('data', (chunk) => stdout.push(chunk));
    child.stderr?.on('data', (chunk) => stderr.push(chunk));
    child.on('error', rejectRun);
    child.on('close', (code) => {
      if (code === 0) resolveRun(Buffer.concat(stdout));
      else
        rejectRun(
          new Error(
            `${command} exited ${code}: ${Buffer.concat(stderr).toString('utf8').slice(-1000)}`,
          ),
        );
    });
  });
}

async function acquireClip(candidate, index) {
  const id = `cb-${String(index + 1).padStart(4, '0')}-${sha256(candidate.sourceUrl).slice(0, 8)}`;
  const path = resolve(mediaRoot, `${id}.mp4`);
  if (downloadMedia && overwrite) {
    await writeFile(path, Buffer.alloc(0));
  }
  if (downloadMedia) {
    try {
      const existing = await readFile(path);
      if (existing.length === 0) throw new Error('empty');
    } catch {
      if (cachedOnly) throw new Error('Media cache miss; network acquisition disabled.');
      for (let attempt = 0; attempt < 12; attempt += 1) {
        const response = await fetch(candidate.acquisitionUrl, {
          method: 'HEAD',
          headers: {
            'user-agent': 'NodeVideo-CreatorBench/1.0 (rights-governed research benchmark)',
          },
        });
        if (response.ok) break;
        if (response.status !== 429) {
          throw new Error(`Media preflight failed with HTTP ${response.status}.`);
        }
        const retryAfterMs = Number(response.headers.get('retry-after') ?? 55) * 1_000;
        if (attempt === 11)
          throw new Error('Media host remained rate-limited after bounded retries.');
        await wait(Math.min(55_000, Math.max(2_500, retryAfterMs)));
      }
      const audioArguments = candidate.stripAudio
        ? ['-an']
        : ['-map', '0:a:0?', '-c:a', 'aac', '-b:a', '64k'];
      await run('ffmpeg', [
        '-y',
        '-hide_banner',
        '-loglevel',
        'error',
        '-user_agent',
        'NodeVideo-CreatorBench/1.0 (rights-governed research benchmark)',
        '-reconnect',
        '1',
        '-reconnect_streamed',
        '1',
        '-reconnect_delay_max',
        '3',
        '-ss',
        '0',
        '-i',
        candidate.acquisitionUrl,
        '-t',
        String(config.clipDurationSeconds),
        '-map',
        '0:v:0',
        ...audioArguments,
        '-vf',
        'scale=min(640\\,iw):-2:force_original_aspect_ratio=decrease',
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '28',
        '-pix_fmt',
        'yuv420p',
        '-movflags',
        '+faststart',
        path,
      ]);
    }
  }
  const bytes = downloadMedia ? await readFile(path) : Buffer.from(candidate.sourceUrl);
  let probe = { format: {}, streams: [] };
  if (downloadMedia) {
    const { stdout } = await execFileAsync(
      'ffprobe',
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration,size:stream=index,codec_type,codec_name,width,height,r_frame_rate,avg_frame_rate',
        '-of',
        'json',
        path,
      ],
      { maxBuffer: 2_000_000 },
    );
    probe = JSON.parse(stdout);
  }
  let visualPerceptualHash = null;
  let audioFingerprint = null;
  if (downloadMedia) {
    const gray = await run('ffmpeg', [
      '-v',
      'error',
      '-i',
      path,
      '-frames:v',
      '1',
      '-vf',
      'scale=9:8,format=gray',
      '-f',
      'rawvideo',
      'pipe:1',
    ]);
    const bits = [];
    for (let y = 0; y < 8; y += 1)
      for (let x = 0; x < 8; x += 1) bits.push(gray[y * 9 + x] > gray[y * 9 + x + 1] ? '1' : '0');
    visualPerceptualHash = BigInt(`0b${bits.join('')}`)
      .toString(16)
      .padStart(16, '0');
    try {
      const audio = await run('ffmpeg', [
        '-v',
        'error',
        '-i',
        path,
        '-vn',
        '-ac',
        '1',
        '-ar',
        '8000',
        '-t',
        String(config.clipDurationSeconds),
        '-f',
        's16le',
        'pipe:1',
      ]);
      audioFingerprint = audio.length > 0 ? `sha256:${sha256(audio)}` : 'no-audio';
    } catch {
      audioFingerprint = 'no-audio';
    }
  }
  const video = probe.streams.find((stream) => stream.codec_type === 'video');
  const audio = probe.streams.find((stream) => stream.codec_type === 'audio');
  return {
    id,
    title: candidate.title,
    domain: candidate.domain,
    sourceProvider: candidate.sourceProvider ?? 'wikimedia',
    sourceLocatorClass: candidate.sourceLocatorClass ?? 'wikimedia-commons-public',
    sourceUrl: candidate.sourcePage,
    mediaUrl: candidate.sourceUrl,
    creatorId: candidate.creatorId,
    license: candidate.license,
    licenseUrl: candidate.licenseUrl,
    attribution: candidate.attribution,
    acquiredAt: new Date().toISOString(),
    sourceSha256: `sha256:${sha256(bytes)}`,
    originalSourceSha1: candidate.originalSha1,
    durationSeconds: Number(probe.format.duration ?? config.clipDurationSeconds),
    media: {
      mimeType: 'video/mp4',
      codec: video?.codec_name ?? 'unknown',
      width: video?.width ?? null,
      height: video?.height ?? null,
      averageFrameRate: video?.avg_frame_rate ?? null,
      hasAudio: Boolean(audio),
      audioCodec: audio?.codec_name ?? null,
      byteLength: bytes.length,
    },
    permittedBenchmarkUses: candidate.permittedBenchmarkUses,
    permittedRedistribution: candidate.permittedRedistribution,
    relatedSourceGroup: candidate.relatedSourceGroup,
    knownLimitations: [
      'Six-second normalized derivative; source semantics require human review.',
      ...(candidate.knownLimitations ?? []),
    ],
    visualPerceptualHash,
    audioFingerprint,
    localCacheKey: `${id}.mp4`,
  };
}

function balancedCreatorSplits(records) {
  const groups = new Map();
  for (const record of records)
    groups.set(record.creatorId, [...(groups.get(record.creatorId) ?? []), record]);
  const ordered = [...groups.entries()].sort(
    ([left], [right]) => stableNumber(left) - stableNumber(right),
  );
  const desired = {
    'private-heldout': Math.ceil(
      (records.length * config.splitPercentages['private-heldout']) / 100,
    ),
    adversarial: Math.ceil((records.length * config.splitPercentages.adversarial) / 100),
    'public-test': Math.ceil((records.length * config.splitPercentages['public-test']) / 100),
  };
  const counts = { development: 0, 'public-test': 0, 'private-heldout': 0, adversarial: 0 };
  const assignment = new Map();
  for (const split of ['private-heldout', 'adversarial', 'public-test']) {
    while (counts[split] < desired[split] && ordered.length) {
      const [creatorId, creatorRecords] = ordered.shift();
      assignment.set(creatorId, split);
      counts[split] += creatorRecords.length;
    }
  }
  for (const [creatorId, creatorRecords] of ordered) {
    assignment.set(creatorId, 'development');
    counts.development += creatorRecords.length;
  }
  return assignment;
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      try {
        results[index] = await fn(items[index], index);
        process.stdout.write(`\rAcquired ${results.filter(Boolean).length}/${items.length}`);
      } catch (error) {
        const failedId = `cb-${String(index + 1).padStart(4, '0')}-${sha256(items[index].sourceUrl).slice(0, 8)}`;
        await unlink(resolve(mediaRoot, `${failedId}.mp4`)).catch(() => undefined);
        const message = error instanceof Error ? error.message : String(error);
        acquisitionFailures.push({
          category: /cache miss/iu.test(message)
            ? 'cache-not-acquired'
            : /rate-limit|429/iu.test(message)
              ? 'source-host-rate-limit'
              : /does not contain any stream|ffprobe|decode/iu.test(message)
                ? 'media-decode'
                : /HTTP|4XX|5XX/iu.test(message)
                  ? 'source-http'
                  : 'other',
          message: message.slice(0, 300),
        });
        process.stderr.write(`\nSkipped ${items[index].sourceUrl}: ${error.message}\n`);
      }
      if (downloadMedia && !cachedOnly) {
        await wait(Number(process.env.NODEVIDEO_CREATORBENCH_MEDIA_DELAY_MS ?? 2_500));
      }
    }
  }
  await Promise.all(Array.from({ length: limit }, worker));
  process.stdout.write('\n');
  return results.filter(Boolean);
}

const existingRecords = overwrite ? [] : await readExistingVault();
const reusableExisting = existingRecords.slice(0, target);
const requiredNew = Math.max(0, target - reusableExisting.length);
const candidates = await collectCandidates(requiredNew, reusableExisting);
if (discoverOnly) {
  console.log(
    JSON.stringify(
      {
        requestedTotal: target,
        reusableCached: reusableExisting.length,
        discoveredNew: candidates.length,
        providers: [...providers],
        providerCounts: Object.fromEntries(
          Object.entries(
            Object.groupBy(candidates, (candidate) => candidate.sourceProvider ?? 'wikimedia'),
          ).map(([provider, records]) => [provider, records.length]),
        ),
      },
      null,
      2,
    ),
  );
  process.exit(0);
}
if (reusableExisting.length + candidates.length < target) {
  throw new Error(
    `Only ${reusableExisting.length + candidates.length} rights-cleared cached or discovered candidates found; target is ${target}.`,
  );
}
const acquired = await mapLimit(
  candidates.slice(0, requiredNew + 40),
  downloadMedia ? 2 : 12,
  (candidate, index) => acquireClip(candidate, reusableExisting.length + index),
);
const selectedRaw = [...reusableExisting, ...acquired].slice(0, target);
const creatorSplits = balancedCreatorSplits(selectedRaw);
const selected = selectedRaw.map((record) => ({
  ...record,
  split: creatorSplits.get(record.creatorId),
}));
const rightsStatus = (license) => {
  if (license === 'CC0') return 'cc0';
  if (/public domain/iu.test(license)) return 'public-domain';
  return 'cc-by';
};
const frameRate = (value) => {
  const [numerator, denominator = '1'] = String(value ?? '0/1')
    .split('/')
    .map(Number);
  return denominator === 0 ? 0 : numerator / denominator;
};
const asSourceRecord = (record) => ({
  schemaVersion: 'nodevideo.creatorbench-source/v1',
  id: record.id,
  ...(record.split === 'private-heldout'
    ? { privateLocatorClass: 'encrypted-evaluator-vault' }
    : { sourceUrl: record.sourceUrl }),
  creatorOwnerId: record.creatorId,
  relatedSourceGroupId: record.relatedSourceGroup,
  title: record.title,
  rights: {
    status: rightsStatus(record.license),
    licenseName: record.license,
    ...(record.licenseUrl ? { licenseUrl: record.licenseUrl } : {}),
    attribution: record.attribution,
    permittedBenchmarkUses: ['analysis', 'derivatives', 'human-review', 'publication'],
    permittedRedistribution: record.split !== 'private-heldout',
  },
  privacy: record.split === 'private-heldout' ? 'private' : 'public',
  acquiredAt: record.acquiredAt,
  sourceSha256: record.sourceSha256,
  durationMs: record.durationSeconds * 1_000,
  media: {
    width: record.media.width,
    height: record.media.height,
    fps: frameRate(record.media.averageFrameRate),
    codec: record.media.codec,
    hasAudio: record.media.hasAudio,
  },
  split: record.split,
  knownLimitations: record.knownLimitations,
});
const asSplitAssignment = (record) => ({
  schemaVersion: 'nodevideo.creatorbench-split/v1',
  sourceId: record.id,
  split: record.split,
  creatorOwnerId: record.creatorId,
  relatedSourceGroupId: record.relatedSourceGroup,
  perceptualHash: `sha256:${sha256(record.visualPerceptualHash ?? record.sourceSha256)}`,
  ...(record.audioFingerprint && record.audioFingerprint !== 'no-audio'
    ? { audioFingerprint: record.audioFingerprint }
    : {}),
  assignedAt: record.acquiredAt,
  assignmentPolicyVersion: 'creator-source-disjoint-hash-v1',
});
const sourceRecords = selected.map(asSourceRecord);
const splitAssignments = selected.map(asSplitAssignment);
const publicRecords = sourceRecords.filter((record) => record.split !== 'private-heldout');
const privateRecords = sourceRecords.filter((record) => record.split === 'private-heldout');
const publicAssignments = splitAssignments.filter((record) => record.split !== 'private-heldout');
const privateAssignments = splitAssignments.filter((record) => record.split === 'private-heldout');

const publicCatalog = {
  schemaVersion: 'nodevideo.creatorbench-source-catalog.v1',
  benchmarkVersion: config.benchmarkVersion,
  generatedAt: new Date().toISOString(),
  records: publicRecords,
};
const privateCatalog = {
  schemaVersion: 'nodevideo.creatorbench-private-catalog.v1',
  benchmarkVersion: config.benchmarkVersion,
  generatedAt: new Date().toISOString(),
  records: privateRecords,
};
await writeFile(
  resolve(catalogRoot, 'public-sources.json'),
  `${JSON.stringify(publicCatalog, null, 2)}\n`,
);
await writeFile(
  resolve(evidenceRoot, 'private-heldout-catalog.json'),
  `${JSON.stringify(privateCatalog, null, 2)}\n`,
);
await writeFile(
  resolve(catalogRoot, 'public-splits.json'),
  `${JSON.stringify({ schemaVersion: 'nodevideo.creatorbench-split-catalog/v1', benchmarkVersion: config.benchmarkVersion, generatedAt: new Date().toISOString(), assignments: publicAssignments }, null, 2)}\n`,
);
await writeFile(
  resolve(evidenceRoot, 'private-heldout-splits.json'),
  `${JSON.stringify({ schemaVersion: 'nodevideo.creatorbench-private-split-catalog/v1', benchmarkVersion: config.benchmarkVersion, generatedAt: new Date().toISOString(), assignments: privateAssignments }, null, 2)}\n`,
);
await writeFile(
  resolve(evidenceRoot, 'acquisition-vault.json'),
  `${JSON.stringify({ schemaVersion: 'nodevideo.creatorbench-acquisition-vault.v1', benchmarkVersion: config.benchmarkVersion, records: selected }, null, 2)}\n`,
);

const creators = new Set(selected.map((record) => record.creatorId));
const domains = new Set(selected.map((record) => record.domain));
const splitCounts = Object.fromEntries(
  Object.keys(config.splitPercentages).map((split) => [
    split,
    selected.filter((record) => record.split === split).length,
  ]),
);
const receipt = {
  schemaVersion: 'nodevideo.creatorbench-acquisition-receipt.v1',
  benchmarkVersion: config.benchmarkVersion,
  generatedAt: new Date().toISOString(),
  requestedClips: target,
  acquiredClips: selected.length,
  publicCatalogRecords: publicRecords.length,
  privateCatalogRecords: privateRecords.length,
  creators: creators.size,
  domains: domains.size,
  splitCounts,
  allowedLicenses: config.allowedLicenses,
  licenseCounts: Object.fromEntries(
    Object.entries(Object.groupBy(selected, (record) => record.license)).map(
      ([license, records]) => [license, records.length],
    ),
  ),
  providerCounts: Object.fromEntries(
    Object.entries(Object.groupBy(selected, (record) => record.sourceProvider ?? 'wikimedia')).map(
      ([provider, records]) => [provider, records.length],
    ),
  ),
  privateCatalogSha256: `sha256:${sha256(JSON.stringify(privateCatalog))}`,
  publicCatalogSha256: `sha256:${sha256(JSON.stringify(publicCatalog))}`,
  cacheRootClass: '.qa/evidence/creatorbench-v1/media',
  acquisitionGap: Math.max(0, target - selected.length),
  failureCount: acquisitionFailures.length,
  failureCategories: Object.fromEntries(
    Object.entries(Object.groupBy(acquisitionFailures, (failure) => failure.category)).map(
      ([category, failures]) => [category, failures.length],
    ),
  ),
  gapReasons:
    selected.length < target
      ? [
          'Rights-cleared candidates that could not be normalized are excluded; source-host throttling and decode failures remain visible in this receipt.',
        ]
      : [],
};
await writeFile(
  resolve(receiptRoot, 'acquisition-receipt.json'),
  `${JSON.stringify(receipt, null, 2)}\n`,
);
console.log(JSON.stringify(receipt, null, 2));
