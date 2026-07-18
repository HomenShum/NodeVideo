#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { basename, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const { modelConfigured, runEditAgent } = await import('./edit-agent.mjs');
const root = resolve(import.meta.dirname, '../..');
const host = process.env.NODEVIDEO_COACH_HOST ?? '127.0.0.1';
const port = Number(process.env.NODEVIDEO_COACH_PORT ?? 4319);
const token = process.env.NODEVIDEO_COACH_TOKEN ?? randomBytes(18).toString('base64url');
// The deployed web copy of the panel may also talk to this local worker; the
// page is HTTPS and 127.0.0.1 is a trustworthy origin, but Chrome's private
// network access check requires the preflight opt-in header below.
const webOrigin = process.env.NODEVIDEO_COACH_WEB_ORIGIN ?? 'https://nodevideo-pi.vercel.app';
const python = process.env.NODEVIDEO_PYTHON ?? 'python';
const model = resolve(
  process.env.NODEVIDEO_POSE_MODEL ?? join(root, '.qa/models/pose_landmarker_full.task'),
);
const jobsRoot = resolve(
  process.env.NODEVIDEO_COACH_JOBS ?? join(root, '.qa/evidence/private/choreography-jobs'),
);
const poseCacheRoot = resolve(root, '.qa/cache/private-pose');
const analysisMediaCacheRoot = resolve(root, '.qa/cache/private-analysis-media');
const jobs = new Map();
const maxUpload = 700 * 1024 * 1024;
// The edit-agent body carries a full edit plan (~100KB with beat grids).
const maxEditAgentBody = 512 * 1024;
// The coach chat body is a tiny JSON envelope ({ jobId, message }); anything
// larger is abuse. Bound it like every other in-memory buffer in this file so
// a token-holding agent loop cannot OOM the worker mid-analysis.
const maxChatBody = 64 * 1024;
// Bound the in-memory job registry and the number of concurrently running
// jobs. Each job spawns yt-dlp + ffmpeg + Python, so an unbounded registry or
// unbounded concurrency exhausts memory/CPU under an agent loop.
const TERMINAL_STATUSES = new Set(['completed', 'abstained', 'failed']);
const maxJobs = Math.max(1, Number(process.env.NODEVIDEO_COACH_MAX_JOBS ?? 200));
const maxActiveJobs = Math.max(1, Number(process.env.NODEVIDEO_COACH_MAX_ACTIVE ?? 2));
let activeJobs = 0;

function evictTerminalJobs() {
  if (jobs.size <= maxJobs) return;
  const evictable = [...jobs.values()]
    .filter((job) => TERMINAL_STATUSES.has(job.status))
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  while (jobs.size > maxJobs && evictable.length > 0) {
    jobs.delete(evictable.shift().id);
  }
}

await mkdir(jobsRoot, { recursive: true });
await mkdir(poseCacheRoot, { recursive: true });
await mkdir(analysisMediaCacheRoot, { recursive: true });
await restoreJobs();

const server = createServer(async (request, response) => {
  const origin = request.headers.origin ?? '';
  if (origin && !isAllowedOrigin(origin))
    return json(response, 403, { error: 'origin_not_allowed' });
  if (origin) response.setHeader('access-control-allow-origin', origin);
  response.setHeader('vary', 'origin');
  response.setHeader('access-control-allow-headers', 'authorization,content-type');
  response.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
  if (request.method === 'OPTIONS') {
    if (request.headers['access-control-request-private-network'] === 'true')
      response.setHeader('access-control-allow-private-network', 'true');
    return response.writeHead(204).end();
  }
  try {
    if (request.method === 'GET' && request.url === '/health') {
      return json(response, 200, {
        service: 'nodevideo-choreography-coach',
        version: 1,
        privateLocal: true,
      });
    }
    if (!authorized(request)) return json(response, 401, { error: 'invalid_token' });
    if (request.method === 'POST' && request.url === '/v1/coach/chat')
      return await coachChat(request, response);
    if (request.method === 'POST' && request.url === '/v1/edit/agent')
      return await editAgentRoute(request, response);
    if (request.method === 'POST' && request.url === '/v1/jobs')
      return createJob(request, response);
    const jobMatch = request.url?.match(/^\/v1\/jobs\/([a-z0-9-]+)$/);
    if (request.method === 'GET' && jobMatch) {
      const job = jobs.get(jobMatch[1]);
      return job
        ? json(response, 200, publicJob(job))
        : json(response, 404, { error: 'job_not_found' });
    }
    const artifactMatch = request.url?.match(
      /^\/v1\/jobs\/([a-z0-9-]+)\/artifacts\/([a-z0-9.-]+)$/,
    );
    if (request.method === 'GET' && artifactMatch)
      return serveArtifact(response, artifactMatch[1], artifactMatch[2]);
    return json(response, 404, { error: 'not_found' });
  } catch (error) {
    // A handler that already committed its response headers (e.g. an SSE
    // stream) cannot be answered with json() — that throws
    // ERR_HTTP_HEADERS_SENT and would surface as an unhandled rejection.
    // Tear the socket down instead; the stream handler owns in-band errors.
    if (response.headersSent) return response.destroy();
    return json(response, 400, {
      error: error instanceof Error ? error.message : 'request_failed',
    });
  }
});

server.listen(port, host, () => {
  console.log(`NodeVideo choreography coach listening at http://${host}:${port}`);
  console.log(`Extension token: ${token}`);
  console.log('Private local analysis only; no media is uploaded by this service.');
});

// Rule-grounded coach thread: every reply is computed from the stored verdict
// on this machine — visible tool executions, a real reasoning trace, and at
// most one inline proposal the panel can accept in place. No cloud model is
// involved; when an LLM (Eve) is connected it streams over this same event
// contract. Events: reasoning | tool | text | proposal | done.
async function coachChat(request, response) {
  // Bound the body: reject oversized or headerless requests up front (fail
  // closed like createJob), then cap cumulatively inside the read loop so a
  // chunked-transfer body cannot bypass the content-length check.
  const declared = Number(request.headers['content-length'] ?? 0);
  if (!(declared > 0) || declared > maxChatBody)
    return json(response, 413, { error: 'chat_body_too_large' });
  const parts = [];
  let received = 0;
  try {
    for await (const part of request) {
      received += part.length;
      if (received > maxChatBody) {
        request.destroy();
        return json(response, 413, { error: 'chat_body_too_large' });
      }
      parts.push(part);
    }
  } catch {
    // Client aborted mid-body; the socket is gone, nothing to answer.
    return response.destroyed ? undefined : response.destroy();
  }
  let body = {};
  try {
    body = JSON.parse(Buffer.concat(parts).toString('utf8'));
  } catch {
    return json(response, 400, { error: 'invalid_json' });
  }
  const message = String(body.message ?? '').slice(0, 2000);
  const jobId = String(body.jobId ?? '');
  const job = jobs.get(jobId);
  // A supplied-but-unknown job id (typo, or evicted/trimmed after a restart)
  // is a not-found, not a "you never ran a comparison" — mirror the GET route
  // so an agent client can tell the two apart before we commit to SSE.
  if (jobId && !job) return json(response, 404, { error: 'job_not_found' });

  response.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
  });
  const send = (event) => {
    if (response.writableEnded || response.destroyed) return;
    response.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  const say = (text) => {
    for (const word of text.split(/(?<= )/)) send({ type: 'text', delta: word });
  };

  // Everything past the SSE header runs inside a boundary: a throw here must
  // become an in-band error event, never an unhandled rejection that crashes
  // the worker and takes every running job down with it.
  try {
    const verdict = job?.verdict;
    const wants = (pattern) => pattern.test(message);

    if (!verdict) {
      say(
        'I coach from evidence, so I need a completed comparison first. Upload your take, run Judge choreography, then ask me anything about the result.',
      );
    } else if (wants(/segment|window|where.*(practice|start)|propose/i)) {
      const window = verdict.measurements?.referenceWindow;
      const hasWindow =
        window && Number.isFinite(window.startSeconds) && Number.isFinite(window.endSeconds);
      send({
        type: 'reasoning',
        delta: hasWindow
          ? 'The judge located your take inside the reference; reusing that window keeps the next run comparable. '
          : 'Checking whether the last verdict measured a matched window to reuse. ',
      });
      send({
        type: 'tool',
        name: 'locate_reference_window',
        input: { jobId: job.id },
        output: hasWindow ? window : { error: 'window_not_measured' },
      });
      if (hasWindow) {
        const start = Math.round(window.startSeconds * 10) / 10;
        const end = Math.round(window.endSeconds * 10) / 10;
        say(
          `Your take matched the reference between ${start}s and ${end}s. Locking that segment focuses the next comparison on exactly the choreography you practiced.`,
        );
        send({
          type: 'proposal',
          proposal: {
            kind: 'reference-segment',
            startSeconds: start,
            endSeconds: end,
            rationale: 'Matched window from the last comparison',
          },
        });
      } else {
        say(
          'The last run did not measure a reference window, so I have no segment to propose. Run a comparison first.',
        );
      }
    } else if (wants(/moment|review|worst|timestamp/i)) {
      // Only rank moments whose timestamps are actually numbers, so a legacy
      // or partially-written verdict cannot throw on .toFixed below.
      const moments = [...(verdict.criticalMoments ?? [])]
        .filter((m) => Number.isFinite(m?.referenceTime) && Number.isFinite(m?.attemptTime))
        .sort((a, b) => b.severity - a.severity)
        .slice(0, 3);
      send({
        type: 'reasoning',
        delta: `Ranking ${moments.length} flagged moments by severity. `,
      });
      send({
        type: 'tool',
        name: 'list_critical_moments',
        input: { jobId: job.id, top: 3 },
        output: moments,
      });
      if (moments.length === 0) {
        say('No moments crossed the review threshold in this comparison.');
      } else {
        const worst = moments[0];
        say(
          `${moments.length} moments are worth reviewing. The largest difference is at ${worst.referenceTime.toFixed(1)}s in the reference (${worst.attemptTime.toFixed(1)}s in your take) — scrub the comparison video there and watch both dancers on the same count.`,
        );
      }
    } else {
      const scores = Object.entries(verdict.scores ?? {}).filter(([, v]) => typeof v === 'number');
      const unmeasured = verdict.unmeasurableScores ?? [];
      const timing = verdict.measurements?.medianTimingErrorMs;
      const ranked = [...scores].sort((a, b) => a[1] - b[1]);
      send({
        type: 'reasoning',
        delta: `Measured signals ranked: ${ranked.map(([k, v]) => `${k} ${v}`).join(', ')}. ${timing != null ? `Median timing offset ${timing}ms. ` : ''}${unmeasured.length ? `Unmeasured: ${unmeasured.join(', ')} — I will not invent those. ` : ''}`,
      });
      send({
        type: 'tool',
        name: 'get_verdict',
        input: { jobId: job.id },
        output: {
          scores: verdict.scores,
          unmeasurableScores: unmeasured,
          confidence: verdict.confidence,
        },
      });
      if (ranked.length === 0) {
        say(
          'This verdict has no measurable scores — the evidence was too thin to coach from. Try a clearer recording.',
        );
      } else {
        const [weakestName] = ranked[0];
        const advice = {
          timing: `your landings drift from the reference count${timing != null ? ` by about ${timing}ms at the median` : ''} — practice with the music at half speed and land the hits on the count`,
          form: 'your joint angles differ most from the reference — pick the worst moment below and match the exact shape at the hit',
          path: 'your body travels differently across the floor — walk the pattern without arms first',
          dynamics:
            'your accents are softer or sharper than the reference — exaggerate the pops, relax the transitions',
          formation:
            'spacing relative to the team drifts — anchor to the dancer next to you at each landmark',
        };
        say(
          `These are relative signals, not grades. The furthest signal from the reference is ${weakestName}: ${advice[weakestName] ?? 'review the flagged moments below'}. Ask "propose a practice segment" and I will lock the matched window for your next run.`,
        );
      }
    }
  } catch {
    send({ type: 'error', error: 'coach_reply_failed' });
  }
  send({ type: 'done' });
  if (!response.writableEnded) response.end();
}

// Model-backed edit agent bridge (see edit-agent.mjs). Honest about absence:
// with no Anthropic credentials configured this returns 503 and the studio
// stays on its local rule agent — a model is never faked.
async function editAgentRoute(request, response) {
  if (!modelConfigured()) return json(response, 503, { error: 'model_not_configured' });
  const declared = Number(request.headers['content-length'] ?? 0);
  if (!(declared > 0) || declared > maxEditAgentBody)
    return json(response, 413, { error: 'edit_agent_body_too_large' });
  const parts = [];
  let received = 0;
  try {
    for await (const part of request) {
      received += part.length;
      if (received > maxEditAgentBody) {
        request.destroy();
        return json(response, 413, { error: 'edit_agent_body_too_large' });
      }
      parts.push(part);
    }
  } catch {
    return response.destroyed ? undefined : response.destroy();
  }
  let body = {};
  try {
    body = JSON.parse(Buffer.concat(parts).toString('utf8'));
  } catch {
    return json(response, 400, { error: 'invalid_json' });
  }
  if (!body.plan?.tracks || !body.plan?.beatGrid || typeof body.message !== 'string')
    return json(response, 422, { error: 'plan_and_message_required' });

  response.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
  });
  const send = (event) => {
    if (response.writableEnded || response.destroyed) return;
    response.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  try {
    await runEditAgent({
      plan: body.plan,
      message: body.message,
      history: Array.isArray(body.history) ? body.history.slice(-12) : [],
      send,
    });
  } catch (error) {
    send({
      type: 'error',
      error: error?.status === 401 ? 'model_auth_failed' : 'edit_agent_failed',
    });
  }
  send({ type: 'done' });
  if (!response.writableEnded) response.end();
}

async function createJob(request, response) {
  if (activeJobs >= maxActiveJobs)
    return json(response, 429, {
      error: 'too_many_active_jobs',
      activeJobs,
      maxActiveJobs,
    });
  const contentLength = Number(request.headers['content-length'] ?? 0);
  if (contentLength <= 0 || contentLength > maxUpload)
    return json(response, 413, { error: 'upload_too_large' });
  const webRequest = new Request('http://localhost/v1/jobs', {
    method: 'POST',
    headers: request.headers,
    body: Readable.toWeb(request),
    duplex: 'half',
  });
  const form = await webRequest.formData();
  if (form.get('rightsConfirmed') !== 'true')
    return json(response, 422, { error: 'rights_confirmation_required' });
  const attempt = form.get('attempt');
  const referenceFile = form.get('reference');
  const referenceUrl = String(form.get('referenceUrl') ?? '').trim();
  if (!(attempt instanceof File) || attempt.size === 0)
    return json(response, 422, { error: 'attempt_required' });
  if (!(referenceFile instanceof File) && !validYouTubeUrl(referenceUrl)) {
    return json(response, 422, { error: 'youtube_reference_or_file_required' });
  }
  const referenceStartSeconds = optionalNumber(form.get('referenceStartSeconds'));
  const referenceEndSeconds = optionalNumber(form.get('referenceEndSeconds'));
  if (
    (referenceStartSeconds === null) !== (referenceEndSeconds === null) ||
    (referenceStartSeconds !== null &&
      (!Number.isFinite(referenceStartSeconds) ||
        !Number.isFinite(referenceEndSeconds) ||
        referenceStartSeconds < 0 ||
        referenceEndSeconds <= referenceStartSeconds ||
        referenceEndSeconds - referenceStartSeconds > 90))
  ) {
    return json(response, 422, { error: 'invalid_reference_segment' });
  }
  const id = `coach-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
  const directory = join(jobsRoot, id);
  await mkdir(directory, { recursive: true });
  const attemptOriginalPath = join(directory, safeMediaName('attempt', attempt.name));
  await writeFile(attemptOriginalPath, Buffer.from(await attempt.arrayBuffer()));
  let referencePath = null;
  if (referenceFile instanceof File && referenceFile.size > 0) {
    referencePath = join(directory, safeMediaName('reference', referenceFile.name));
    await writeFile(referencePath, Buffer.from(await referenceFile.arrayBuffer()));
  }
  const job = {
    id,
    status: 'queued',
    stage: 'queued',
    progress: 0,
    directory,
    attemptOriginalPath,
    attemptPath: attemptOriginalPath,
    referencePath,
    referenceUrl,
    referenceStartSeconds,
    referenceEndSeconds,
    people: clamp(Number(form.get('people') ?? 10), 1, 10),
    createdAt: new Date().toISOString(),
    artifacts: {},
    events: [],
  };
  jobs.set(id, job);
  evictTerminalJobs();
  await persist(job);
  void runJob(job);
  return json(response, 202, publicJob(job));
}

async function runJob(job) {
  activeJobs += 1;
  try {
    if (!job.referencePath) {
      update(job, 'acquiring_reference', 8, 'Resolving authorized YouTube reference');
      job.referencePath = join(job.directory, 'reference.mp4');
      await exec(
        'yt-dlp',
        [
          '--no-playlist',
          '--match-filter',
          'duration <= 900',
          '--max-filesize',
          '500M',
          '-f',
          'bv*[height<=720]+ba/b[height<=720]',
          '--merge-output-format',
          'mp4',
          '-o',
          job.referencePath,
          job.referenceUrl,
        ],
        { timeout: 10 * 60_000, windowsHide: true },
      );
    }
    if (
      job.referenceStartSeconds === null &&
      job.referenceEndSeconds === null &&
      (await mediaDurationSeconds(job.referencePath)) > 90
    ) {
      throw new Error('reference_segment_required_for_long_video');
    }
    update(job, 'normalizing_attempt', 14, 'Preparing a deterministic analysis proxy');
    job.attemptPath = await ensureAnalysisProxy(
      job.attemptOriginalPath ?? job.attemptPath,
      job.directory,
    );
    await ensureModel();
    const referenceTrack = join(job.directory, 'reference-pose.npz');
    const attemptTrack = join(job.directory, 'attempt-pose.npz');
    update(job, 'extracting_reference_pose', 22, 'Running MediaPipe on reference');
    await extractPose(job.referencePath, referenceTrack, job.people);
    update(job, 'extracting_attempt_pose', 43, 'Running MediaPipe on attempt');
    await extractPose(job.attemptPath, attemptTrack, job.people);
    update(job, 'aligning_motion', 62, 'Aligning choreography with constrained DTW');
    const verdictPath = join(job.directory, 'verdict.json');
    const judgeArguments = [
      join(root, 'scripts/analysis/choreography_judge.py'),
      '--reference-track',
      referenceTrack,
      '--attempt-track',
      attemptTrack,
      '--output',
      verdictPath,
    ];
    if (job.referenceStartSeconds !== null && job.referenceEndSeconds !== null) {
      judgeArguments.push(
        '--reference-start',
        String(job.referenceStartSeconds),
        '--reference-end',
        String(job.referenceEndSeconds),
      );
    }
    await exec(python, judgeArguments, { timeout: 5 * 60_000, windowsHide: true });
    job.verdict = JSON.parse(await readFile(verdictPath, 'utf8'));
    update(job, 'rendering_comparison', 78, 'Rendering private comparison video');
    const comparison = join(job.directory, 'comparison.mp4');
    await renderComparison(
      job.referencePath,
      job.attemptPath,
      referenceTrack,
      attemptTrack,
      verdictPath,
      comparison,
      job.verdict.measurements?.referenceWindow?.startSeconds ?? 0,
    );
    await writeFile(
      join(job.directory, 'provenance.json'),
      `${JSON.stringify(
        {
          schemaVersion: 'nodevideo.choreography-job-provenance.v1',
          reference: await digest(job.referencePath),
          attempt: await digest(job.attemptOriginalPath ?? job.attemptPath),
          attemptAnalysis: await digest(job.attemptPath),
          attemptAnalysisProxy: job.attemptPath !== (job.attemptOriginalPath ?? job.attemptPath),
          model: await digest(model),
          createdAt: job.createdAt,
          privacy: 'local-private',
          referenceUrl: job.referenceUrl || null,
        },
        null,
        2,
      )}\n`,
    );
    job.artifacts = {
      comparison: artifact(job, 'comparison.mp4', 'video/mp4'),
      verdict: artifact(job, 'verdict.json', 'application/json'),
      referencePose: artifact(job, 'reference-pose.npz', 'application/octet-stream'),
      attemptPose: artifact(job, 'attempt-pose.npz', 'application/octet-stream'),
      provenance: artifact(job, 'provenance.json', 'application/json'),
    };
    job.status = job.verdict.status;
    update(
      job,
      job.verdict.status === 'abstained' ? 'abstained' : 'completed',
      100,
      job.verdict.status === 'abstained'
        ? 'Evidence quality was too low for a verdict'
        : 'Verdict and evidence ready',
    );
  } catch (error) {
    job.status = 'failed';
    job.stage = 'failed';
    job.error = error instanceof Error ? error.message : 'job_failed';
    job.events.push({ at: new Date().toISOString(), stage: 'failed', detail: job.error });
    await persist(job);
  } finally {
    activeJobs -= 1;
  }
}

async function ensureModel() {
  try {
    if ((await stat(model)).size > 1_000_000) return;
  } catch {}
  await mkdir(resolve(model, '..'), { recursive: true });
  const url =
    'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task';
  const response = await fetch(url);
  if (!response.ok) throw new Error(`pose_model_download_failed_${response.status}`);
  await writeFile(model, Buffer.from(await response.arrayBuffer()));
}

async function extractPose(video, output, people) {
  const key = `${await digest(video)}-${await digest(model)}-fps15-people${people}`;
  const cachedTrack = join(poseCacheRoot, `${key}.npz`);
  const cachedMetadata = join(poseCacheRoot, `${key}.json`);
  try {
    if ((await stat(cachedTrack)).size > 1_000) {
      await copyFile(cachedTrack, output);
      await copyFile(cachedMetadata, output.replace(/\.npz$/i, '.json'));
      return;
    }
  } catch {}
  await exec(
    python,
    [
      join(root, 'scripts/analysis/extract_pose_landmarks.py'),
      '--video',
      video,
      '--model',
      model,
      '--output',
      output,
      '--sample-fps',
      '15',
      '--num-poses',
      String(people),
    ],
    { timeout: 12 * 60_000, windowsHide: true },
  );
  await copyFile(output, cachedTrack);
  await copyFile(output.replace(/\.npz$/i, '.json'), cachedMetadata);
}

async function ensureAnalysisProxy(input, directory) {
  const sourceHash = await digest(input);
  const output = join(directory, 'attempt-analysis.mp4');
  const cached = join(analysisMediaCacheRoot, `${sourceHash}-h264-yuv420p-v1.mp4`);
  try {
    if ((await stat(cached)).size > 1_000) {
      await copyFile(cached, output);
      return output;
    }
  } catch {}
  const { stdout } = await exec(
    'ffprobe',
    [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=codec_name,pix_fmt',
      '-of',
      'json',
      input,
    ],
    { timeout: 60_000, windowsHide: true },
  );
  const stream = JSON.parse(stdout).streams?.[0];
  if (stream?.codec_name === 'h264' && stream?.pix_fmt === 'yuv420p') return input;
  await exec(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      input,
      '-map',
      '0:v:0',
      '-map',
      '0:a?',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '20',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '160k',
      '-movflags',
      '+faststart',
      output,
    ],
    { timeout: 12 * 60_000, windowsHide: true },
  );
  await copyFile(output, cached);
  return output;
}

async function mediaDurationSeconds(input) {
  const { stdout } = await exec(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', input],
    { timeout: 60_000, windowsHide: true },
  );
  return Number(JSON.parse(stdout).format?.duration ?? 0);
}

async function renderComparison(
  reference,
  attempt,
  referenceTrack,
  attemptTrack,
  verdict,
  output,
  referenceStart,
) {
  const silent = output.replace(/\.mp4$/i, '-silent.mp4');
  await exec(
    python,
    [
      join(root, 'scripts/analysis/render_choreography_comparison.py'),
      '--reference-video',
      reference,
      '--attempt-video',
      attempt,
      '--reference-track',
      referenceTrack,
      '--attempt-track',
      attemptTrack,
      '--verdict',
      verdict,
      '--output',
      silent,
    ],
    { timeout: 12 * 60_000, windowsHide: true },
  );
  await exec(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      silent,
      '-ss',
      String(referenceStart),
      '-i',
      reference,
      '-map',
      '0:v',
      '-map',
      '1:a?',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '21',
      '-c:a',
      'aac',
      '-b:a',
      '160k',
      '-shortest',
      '-movflags',
      '+faststart',
      output,
    ],
    { timeout: 12 * 60_000, windowsHide: true },
  );
}

async function serveArtifact(response, id, name) {
  const job = jobs.get(id);
  const allowed = job && Object.values(job.artifacts).find((item) => item.name === name);
  if (!allowed) return json(response, 404, { error: 'artifact_not_found' });
  const info = await stat(join(job.directory, name));
  response.writeHead(200, {
    'content-type': allowed.contentType,
    'content-length': info.size,
    'content-disposition': `inline; filename="${name}"`,
    'cache-control': 'private, no-store',
  });
  createReadStream(join(job.directory, name)).pipe(response);
}

function artifact(job, name, contentType) {
  return { name, contentType, url: `/v1/jobs/${job.id}/artifacts/${name}` };
}
function update(job, stage, progress, detail) {
  job.stage = stage;
  job.progress = progress;
  job.events.push({ at: new Date().toISOString(), stage, detail });
  void persist(job);
}
function publicJob(job) {
  return {
    id: job.id,
    status: job.status,
    stage: job.stage,
    progress: job.progress,
    createdAt: job.createdAt,
    verdict: job.verdict,
    error: job.error,
    artifacts: job.artifacts,
    events: job.events.slice(-12),
  };
}
function authorized(request) {
  return request.headers.authorization === `Bearer ${token}`;
}
function isAllowedOrigin(origin) {
  return (
    origin.startsWith('chrome-extension://') ||
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ||
    origin === webOrigin
  );
}
function validYouTubeUrl(value) {
  try {
    const url = new URL(value);
    return (
      ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'].includes(url.hostname) &&
      url.protocol === 'https:'
    );
  } catch {
    return false;
  }
}
function safeMediaName(prefix, name) {
  const ext = basename(name).match(/\.[a-z0-9]{2,5}$/i)?.[0] ?? '.mp4';
  return `${prefix}${ext.toLowerCase()}`;
}
function optionalNumber(value) {
  if (value === null || String(value).trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}
function clamp(value, low, high) {
  return Math.max(low, Math.min(high, Number.isFinite(value) ? Math.round(value) : low));
}
async function digest(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
async function persist(job) {
  await writeFile(join(job.directory, 'job-state.json'), `${JSON.stringify(job, null, 2)}\n`);
}
async function restoreJobs() {
  const restored = [];
  for (const entry of await readdir(jobsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try {
      const job = JSON.parse(await readFile(join(jobsRoot, entry.name, 'job-state.json'), 'utf8'));
      if (!TERMINAL_STATUSES.has(job.status)) {
        job.status = 'failed';
        job.stage = 'failed';
        job.error = 'worker_restarted_before_completion';
      }
      restored.push(job);
    } catch {}
  }
  // Only keep the most recent maxJobs in memory so a large on-disk history
  // cannot re-inflate the registry past its bound on restart.
  restored.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  for (const job of restored.slice(0, maxJobs)) jobs.set(job.id, job);
}
function json(response, status, value) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(value));
}
