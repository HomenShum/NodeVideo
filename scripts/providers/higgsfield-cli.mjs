import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { HiggsfieldCliClient } from '../../src/lib/higgsfield-provider.ts';
import { probeMedia, sanitizeProbe, sha256File } from '../media/media-proof-lib.mjs';

const command = process.argv[2] ?? 'doctor';
const client = new HiggsfieldCliClient();

if (command === 'doctor') {
  const result = {
    schemaVersion: 'nodevideo.higgsfield-doctor.v1',
    authenticated: false,
    workspaceSelected: false,
    account: null,
    error: null,
  };
  try {
    result.account = await client.accountStatus();
    result.authenticated = true;
    result.workspaceSelected = true;
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  }
  console.log(JSON.stringify(result, null, 2));
  if (!result.authenticated) process.exitCode = 2;
} else if (command === 'models') {
  console.log(JSON.stringify(await client.listModels(process.argv[3]), null, 2));
} else if (command === 'run') {
  const requestPath = resolve(process.argv[3] ?? '');
  const request = JSON.parse(await readFile(requestPath, 'utf8'));
  if (request.rights?.mediaEgressApproved !== true || request.rights?.sourceAssetsOwned !== true) {
    throw new Error('Live generation requires owned sources and explicit media-egress approval');
  }
  const outputRoot = resolve(process.argv[4] ?? '.qa/evidence/higgsfield');
  await mkdir(outputRoot, { recursive: true });
  const estimate = await client.estimateCost(request);
  await atomicJson(join(outputRoot, 'cost-estimate.json'), estimate);
  if (process.env.HIGGSFIELD_GENERATION_APPROVED !== '1') {
    await atomicJson(join(outputRoot, 'generation-proposal.json'), {
      schemaVersion: 'nodevideo.higgsfield-generation-proposal.v1',
      request,
      estimate,
      status: 'awaiting-execution-approval',
    });
    console.log(
      'Cost proposal written. Set HIGGSFIELD_GENERATION_APPROVED=1 to create the provider job.',
    );
    process.exit(3);
  }
  const createdAt = new Date().toISOString();
  const created = await client.createGeneration(request);
  const providerJobId = findProviderJobId(created);
  await atomicJson(join(outputRoot, 'provider-job-created.json'), {
    createdAt,
    providerJobId,
    response: created,
  });
  const completed = await client.waitForGeneration(providerJobId);
  await atomicJson(join(outputRoot, 'provider-job-completed.json'), completed);
  const urls = [...new Set(findUrls(completed))];
  if (urls.length === 0)
    throw new Error('Provider job completed without a downloadable output URL');
  const receipts = [];
  for (const [index, url] of urls.entries()) {
    const extension = safeExtension(url);
    const target = join(outputRoot, `output-${String(index + 1).padStart(2, '0')}${extension}`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Output download failed: HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    await writeFile(target, bytes);
    const hash = await sha256File(target);
    let media = null;
    try {
      media = sanitizeProbe(probeMedia(target));
    } catch {
      // Image or provider-specific asset; hash and MIME still prove the bytes.
    }
    const now = new Date().toISOString();
    const receipt = {
      schemaVersion: 'node.asset-receipt.v1',
      id: `asset:higgsfield:${providerJobId}:${index}`,
      assetKind: media?.video ? 'video' : media?.audio ? 'audio' : 'image',
      provider: 'higgsfield',
      model: request.jobType,
      generationId: providerJobId,
      createdAt: now,
      source: {
        promptHash: `sha256:${hashText(request.prompt)}`,
        referenceAssetIds: request.referenceAssetIds ?? [],
        recipeId: request.recipeId,
      },
      output: {
        uri: target,
        sha256: `sha256:${hash}`,
        mimeType: response.headers.get('content-type') ?? 'application/octet-stream',
        sizeBytes: bytes.byteLength,
        width: media?.video?.codedWidth ?? undefined,
        height: media?.video?.codedHeight ?? undefined,
        durationMs: media?.format?.durationSeconds
          ? Math.round(media.format.durationSeconds * 1000)
          : undefined,
      },
      rights: {
        sourceAssetsOwned: true,
        publicReleaseApproved: false,
        syntheticPeopleOnly: Boolean(request.rights.syntheticPeopleOnly),
        thirdPartyMarks: false,
        musicRedistribution: false,
        providerTermsSnapshot: request.rights.providerTermsSnapshot,
        reviewStatus: 'pending',
        notes: [
          'Provider output requires likeness, trademark, music, and originality review before public release.',
        ],
      },
      execution: {
        startedAt: createdAt,
        completedAt: now,
        estimatedCostUsd: numericCost(estimate),
        attempt: 1,
        parametersHash: `sha256:${hashText(JSON.stringify(request.parameters ?? {}))}`,
      },
      evaluation: {
        selected: false,
        scores: {},
        validatorIds: ['provider-job.complete', 'media.probe', 'asset-receipt.schema'],
        limitations: [],
      },
      intendedUses: request.intendedUses ?? [],
    };
    receipts.push(receipt);
    await atomicJson(`${target}.receipt.json`, receipt);
  }
  await atomicJson(join(outputRoot, 'run-receipt.json'), {
    schemaVersion: 'nodevideo.higgsfield-run.v1',
    providerJobId,
    estimate,
    receipts,
  });
  console.log(
    JSON.stringify({ providerJobId, outputs: receipts.map((item) => item.output.uri) }, null, 2),
  );
} else {
  throw new Error(
    'Usage: higgsfield-cli.mjs doctor | models [kind] | run <request.json> [output-dir]',
  );
}

function findProviderJobId(value) {
  const candidates = [];
  visit(value, (key, child) => {
    if (/^(?:job_?id|id)$/iu.test(key) && typeof child === 'string') candidates.push(child);
  });
  const id = candidates.find((item) => /^[A-Za-z0-9:_-]+$/u.test(item));
  if (!id) throw new Error('Could not locate provider job ID in CLI response');
  return id;
}

function findUrls(value) {
  const urls = [];
  visit(value, (key, child) => {
    if (/url/iu.test(key) && typeof child === 'string' && /^https:\/\//u.test(child))
      urls.push(child);
  });
  return urls;
}

function visit(value, callback) {
  if (Array.isArray(value)) {
    for (const child of value) visit(child, callback);
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      callback(key, child);
      visit(child, callback);
    }
  }
}

function safeExtension(url) {
  try {
    const extension = extname(new URL(url).pathname).toLowerCase();
    return /^\.[a-z0-9]{2,5}$/u.test(extension) ? extension : '.bin';
  } catch {
    return '.bin';
  }
}

function hashText(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function numericCost(value) {
  const serialized = JSON.stringify(value);
  const match = serialized.match(/"(?:cost|usd|amount)"\s*:\s*([0-9.]+)/iu);
  return match ? Number(match[1]) : undefined;
}

async function atomicJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`);
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, path);
}
