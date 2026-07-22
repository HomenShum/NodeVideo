import { createHash } from 'node:crypto';

const API_ROOT = 'https://svs.gsfc.nasa.gov/api';
const RIGHTS_URL = 'https://svs.gsfc.nasa.gov/help/';
const ALLOWED_PAGE_TYPES = new Set(['Animation', 'Produced Video', 'Visualization']);

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const wait = (milliseconds) => new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));

function stripHtml(value = '') {
  return String(value)
    .replace(/<[^>]+>/gu, ' ')
    .replace(/&(?:nbsp|#160);/gu, ' ')
    .replace(/&amp;/gu, '&')
    .replace(/&#39;|&apos;/gu, "'")
    .replace(/&quot;/gu, '"')
    .replace(/\s+/gu, ' ')
    .trim();
}

function normalizeIdentifier(value) {
  return stripHtml(value)
    .toLowerCase()
    .replace(/[^a-z\d]+/gu, '-')
    .replace(/^-|-$/gu, '');
}

async function fetchJson(url, fetchImpl, attempts = 4) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const response = await fetchImpl(url, {
      headers: {
        'user-agent': 'NodeVideo-CreatorBench/1.0 (rights-governed research benchmark)',
      },
    });
    if (response.ok) return response.json();
    if (response.status < 500 && response.status !== 429) {
      throw new Error(`NASA SVS request failed with HTTP ${response.status}.`);
    }
    if (attempt + 1 < attempts) await wait(500 * 2 ** attempt);
  }
  throw new Error('NASA SVS request remained unavailable after bounded retries.');
}

function mediaItems(page) {
  return (page.media_groups ?? [])
    .flatMap((group) => group.items ?? [])
    .map((item) => item.instance)
    .filter(Boolean);
}

export function selectNasaSvsMovie(page) {
  return mediaItems(page)
    .filter(
      (item) =>
        item.media_type === 'Movie' &&
        /^https:\/\/svs\.gsfc\.nasa\.gov\//u.test(item.url ?? '') &&
        /\.(?:mp4|webm)$/iu.test(item.filename ?? item.url ?? ''),
    )
    .sort((left, right) => {
      const leftPixels = Number(left.pixels ?? Number.MAX_SAFE_INTEGER);
      const rightPixels = Number(right.pixels ?? Number.MAX_SAFE_INTEGER);
      const leftMp4 = /\.mp4$/iu.test(left.filename ?? left.url ?? '') ? 1 : 0;
      const rightMp4 = /\.mp4$/iu.test(right.filename ?? right.url ?? '') ? 1 : 0;
      return leftPixels - rightPixels || rightMp4 - leftMp4;
    })[0];
}

function creditedCreators(page) {
  const preferredRoles = new Set([
    'Animator',
    'Producer',
    'Video editor',
    'Videographer',
    'Visualizer',
  ]);
  return (page.credits ?? [])
    .filter((credit) => preferredRoles.has(credit.role))
    .flatMap((credit) => credit.people ?? [])
    .map((person) => stripHtml(person.name))
    .filter(Boolean);
}

function containsThirdPartyRestriction(page) {
  const text = stripHtml(
    [page.description, ...(page.media_groups ?? []).map((group) => group.description)].join(' '),
  );
  return /(?:©|copyright(?:ed)?\s+(?:by|material)|all rights reserved)/iu.test(text);
}

export function candidateFromNasaSvsPage(page, domain) {
  if (!page || !ALLOWED_PAGE_TYPES.has(page.page_type) || containsThirdPartyRestriction(page)) {
    return undefined;
  }
  const movie = selectNasaSvsMovie(page);
  if (!movie) return undefined;
  const creators = creditedCreators(page);
  const creatorIdentity = creators[0]
    ? `credited-creator:${normalizeIdentifier(creators[0])}`
    : `source-collection:nasa-svs:${page.id}`;
  const attribution = creators.length
    ? `NASA Scientific Visualization Studio; ${creators.join(', ')}`
    : 'NASA Scientific Visualization Studio';
  return {
    title: stripHtml(page.title),
    domain: domain.id,
    query: domain.query,
    sourceProvider: 'nasa-svs',
    sourceLocatorClass: 'nasa-svs-public-domain',
    sourceUrl: movie.url,
    acquisitionUrl: movie.url,
    sourcePage: page.url ?? `https://svs.gsfc.nasa.gov/${page.id}/`,
    originalSha1: null,
    sourceDurationSeconds: null,
    sourceMimeType: /\.webm$/iu.test(movie.filename ?? '') ? 'video/webm' : 'video/mp4',
    attribution,
    creatorKey: creatorIdentity,
    creatorId: `creator:${sha256(creatorIdentity).slice(0, 16)}`,
    license: 'NASA SVS public domain',
    licenseUrl: RIGHTS_URL,
    permittedBenchmarkUses: ['evaluation', 'derived-six-second-clip', 'public-metadata'],
    permittedRedistribution: true,
    relatedSourceGroup: `nasa-svs:${page.id}`,
    stripAudio: true,
    knownLimitations: [
      'NASA SVS states its visual content is public domain unless otherwise noted.',
      'Audio is removed because some SVS items contain separately licensed music.',
      'Use must not imply NASA endorsement; NASA marks and identifiable-person rights remain separate.',
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

export async function collectNasaSvsCandidates({
  domains,
  target,
  fetchImpl = fetch,
  maximumClipsPerCreator = 3,
}) {
  const resultByPage = new Map();
  const searchLimit = Math.max(12, Math.min(30, Math.ceil((target * 2) / domains.length)));
  for (const domain of domains) {
    if (resultByPage.size >= target * 2) break;
    const params = new URLSearchParams({ search: domain.query, limit: String(searchLimit) });
    const search = await fetchJson(`${API_ROOT}/search/?${params}`, fetchImpl);
    for (const result of search.results ?? []) {
      if (!ALLOWED_PAGE_TYPES.has(result.result_type) || resultByPage.has(result.id)) continue;
      resultByPage.set(result.id, { result, domain });
    }
  }

  const creatorCounts = new Map();
  const pages = await mapLimit([...resultByPage.values()], 6, async ({ result, domain }) => {
    try {
      const page = await fetchJson(`${API_ROOT}/${result.id}/`, fetchImpl);
      return { page, domain };
    } catch {
      return undefined;
    }
  });
  const candidates = [];
  for (const entry of pages.filter(Boolean)) {
    const candidate = candidateFromNasaSvsPage(entry.page, entry.domain);
    if (!candidate) continue;
    const count = creatorCounts.get(candidate.creatorId) ?? 0;
    if (count >= maximumClipsPerCreator) continue;
    creatorCounts.set(candidate.creatorId, count + 1);
    candidates.push(candidate);
    if (candidates.length >= target) break;
  }
  return candidates;
}
