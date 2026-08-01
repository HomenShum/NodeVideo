import { createHash } from 'node:crypto';

const SEARCH_ROOT = 'https://images-api.nasa.gov/search';
const DETAILS_ROOT = 'https://images.nasa.gov/details';
const RIGHTS_URL = 'https://www.nasa.gov/nasa-brand-center/images-and-media/';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const wait = (milliseconds) => new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));

async function fetchJson(url, fetchImpl, attempts = 4) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const response = await fetchImpl(url, {
      headers: {
        'user-agent': 'NodeVideo-CreatorBench/1.0 (rights-governed research benchmark)',
      },
    });
    if (response.ok) return response.json();
    if (response.status < 500 && response.status !== 429) {
      throw new Error(`NASA Images request failed with HTTP ${response.status}.`);
    }
    if (attempt + 1 < attempts) await wait(500 * 2 ** attempt);
  }
  throw new Error('NASA Images request remained unavailable after bounded retries.');
}

function httpsUrl(value) {
  return String(value ?? '').replace(/^http:\/\//u, 'https://');
}

export function selectNasaImagesMovie(collection) {
  return (Array.isArray(collection) ? collection : [])
    .map(httpsUrl)
    .filter(
      (url) =>
        /^https:\/\/images-assets\.nasa\.gov\/video\//u.test(url) && /\.(?:mp4|mov)$/iu.test(url),
    )
    .sort((left, right) => {
      const rank = (url) => {
        if (/~mobile\.mp4$/iu.test(url)) return 0;
        if (/~small\.mp4$/iu.test(url)) return 1;
        if (/~preview\.mp4$/iu.test(url)) return 2;
        if (/~medium\.mp4$/iu.test(url)) return 3;
        if (/~large\.mp4$/iu.test(url)) return 4;
        return 5;
      };
      return rank(left) - rank(right) || left.localeCompare(right);
    })[0];
}

function candidateFromItem(item, collection, domain) {
  const data = item?.data?.[0];
  if (!data?.nasa_id || !data?.title || data.media_type !== 'video') return undefined;
  const movie = selectNasaImagesMovie(collection);
  if (!movie) return undefined;
  const sourceCollection = `source-collection:nasa-images:${data.nasa_id}`;
  return {
    title: data.title,
    domain: domain.id,
    query: domain.query,
    sourceProvider: 'nasa-images',
    sourceLocatorClass: 'nasa-images-evaluation-source',
    sourceUrl: movie,
    acquisitionUrl: movie,
    sourcePage: `${DETAILS_ROOT}/${encodeURIComponent(data.nasa_id)}`,
    originalSha1: null,
    sourceDurationSeconds: null,
    sourceMimeType: 'video/mp4',
    attribution: 'NASA Image and Video Library',
    creatorKey: sourceCollection,
    creatorId: `creator:${sha256(sourceCollection).slice(0, 16)}`,
    license: 'Public domain',
    licenseUrl: RIGHTS_URL,
    permittedBenchmarkUses: ['analysis', 'derivatives', 'human-review'],
    permittedRedistribution: false,
    relatedSourceGroup: `nasa-images:${data.nasa_id}`,
    stripAudio: false,
    startSeconds: 5,
    clipDurationSeconds: 24,
    corpusTier: 'speech-long-form',
    admissibleWorkflows: [
      'talking-head-cleanup',
      'golden-quote-variants',
      'reference-template',
      'captioned-multi-format',
    ],
    admissibilityNotes: [
      'Official NASA interview or presentation source with an audio track, normalized for speech workflow evaluation.',
      'Public metadata may be listed, but derived media is not published by CreatorBench without an additional redistribution review.',
    ],
    knownLimitations: [
      'NASA content is generally not subject to copyright in the United States, but third-party material, music, trademarks, and identifiable-person rights require separate review.',
      'Use must not imply NASA endorsement.',
      'CreatorBench therefore keeps normalized interview derivatives out of the public artifact gallery by default.',
    ],
  };
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export async function collectNasaImagesCandidates({
  target,
  fetchImpl = fetch,
  maximumClipsPerCreator = 3,
}) {
  const domains = [
    { id: 'interview', query: 'astronaut interview' },
    { id: 'talking-head', query: 'NASA interview' },
    { id: 'events-presentations', query: 'NASA briefing' },
    { id: 'public-speech', query: 'NASA speech' },
    { id: 'education-lecture', query: 'NASA lecture' },
    { id: 'product-launch', query: 'NASA mission interview' },
  ];
  const itemsById = new Map();
  for (const domain of domains) {
    const params = new URLSearchParams({
      q: domain.query,
      media_type: 'video',
      page_size: String(Math.max(20, Math.ceil(target / domains.length) * 3)),
    });
    const payload = await fetchJson(`${SEARCH_ROOT}?${params}`, fetchImpl);
    for (const item of payload.collection?.items ?? []) {
      const id = item.data?.[0]?.nasa_id;
      if (!id || itemsById.has(id)) continue;
      itemsById.set(id, { item, domain });
    }
  }
  const expanded = await mapLimit([...itemsById.values()], 6, async ({ item, domain }) => {
    try {
      const collection = await fetchJson(httpsUrl(item.href), fetchImpl);
      return candidateFromItem(item, collection, domain);
    } catch {
      return undefined;
    }
  });
  const creatorCounts = new Map();
  const candidates = [];
  for (const candidate of expanded.filter(Boolean)) {
    const count = creatorCounts.get(candidate.creatorId) ?? 0;
    if (count >= maximumClipsPerCreator) continue;
    creatorCounts.set(candidate.creatorId, count + 1);
    candidates.push(candidate);
    if (candidates.length >= target) break;
  }
  return candidates;
}
