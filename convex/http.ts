import { httpRouter } from 'convex/server';
import { internal } from './_generated/api';
import { httpAction } from './_generated/server';

const http = httpRouter();

type Plane = 'owner' | 'worker' | 'evaluation';

function route(path: string, plane: Plane, handler: (ctx: any, body: any) => Promise<unknown>) {
  http.route({
    path,
    method: 'POST',
    handler: httpAction(async (ctx, request) => {
      const unauthorized = authorize(request, plane);
      if (unauthorized) return unauthorized;
      try {
        const body = await request.json();
        return json(await handler(ctx, body), 200, request);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'control_api_error';
        return json({ error: message }, 400, request);
      }
    }),
  });
}

route('/control/create-source-only-case', 'owner', (ctx, body) =>
  ctx.runMutation(internal.workflow.createCase, body),
);
route('/control/start-job', 'owner', (ctx, body) =>
  ctx.runMutation(internal.workflow.startJob, body),
);
route('/control/read-job', 'owner', async (ctx, body) => {
  const snapshot = await ctx.runQuery(internal.workflow.readJob, body);
  if (snapshot === null) return null;
  return {
    ...snapshot,
    artifacts: await Promise.all(
      snapshot.artifacts.map(async (artifact: any) => ({
        ...artifact,
        url: await ctx.storage.getUrl(artifact.storageRef),
      })),
    ),
  };
});
route('/control/approve-render', 'owner', (ctx, body) =>
  ctx.runMutation(internal.workflow.approveReview, body),
);
route('/control/freeze-plan', 'owner', (ctx, body) =>
  ctx.runMutation(internal.workflow.freezePlan, body),
);
route('/control/cancel-job', 'owner', (ctx, body) =>
  ctx.runMutation(internal.workflow.cancelJob, body),
);
route('/control/retry-stage', 'owner', (ctx, body) =>
  ctx.runMutation(internal.workflow.retryStage, body),
);
route('/control/create-upload-url', 'owner', async (ctx) => ({
  uploadUrl: await ctx.storage.generateUploadUrl(),
}));
route('/control/admit-asset', 'owner', (ctx, body) =>
  ctx.runMutation(internal.workflow.admitAsset, body),
);

route('/control/claim-stage', 'worker', (ctx, body) => {
  if (body.stage === 'evaluate_hidden_target')
    throw new Error('evaluation_stage_requires_evaluator_plane');
  return ctx.runMutation(internal.workflow.claimStage, body);
});
route('/control/complete-stage', 'worker', (ctx, body) => {
  if (body.stage === 'evaluate_hidden_target')
    throw new Error('evaluation_stage_requires_evaluator_plane');
  return ctx.runMutation(internal.workflow.completeStage, body);
});
route('/control/fail-stage', 'worker', (ctx, body) => {
  if (body.stage === 'evaluate_hidden_target')
    throw new Error('evaluation_stage_requires_evaluator_plane');
  return ctx.runMutation(internal.workflow.failStage, body);
});
route('/control/read-worker-input', 'worker', async (ctx, body) => {
  const value = await ctx.runQuery(internal.workflow.readWorkerInput, body);
  return {
    ...value,
    assets: await Promise.all(
      value.assets.map(async (asset: any) => ({
        ...asset,
        url: await ctx.storage.getUrl(asset.storageId),
      })),
    ),
  };
});
route('/control/create-worker-upload-url', 'worker', async (ctx) => ({
  uploadUrl: await ctx.storage.generateUploadUrl(),
}));
route('/control/record-stage-artifact', 'worker', (ctx, body) =>
  ctx.runMutation(internal.workflow.recordStageArtifact, body),
);

route('/control/unseal-evaluation', 'evaluation', (ctx, body) =>
  ctx.runMutation(internal.workflow.unsealEvaluation, body),
);
route('/control/claim-evaluation-stage', 'evaluation', (ctx, body) =>
  ctx.runMutation(internal.workflow.claimStage, { ...body, stage: 'evaluate_hidden_target' }),
);
route('/control/create-evaluation-upload-url', 'evaluation', async (ctx) => ({
  uploadUrl: await ctx.storage.generateUploadUrl(),
}));
route('/control/record-evaluation-artifact', 'evaluation', (ctx, body) =>
  ctx.runMutation(internal.workflow.recordStageArtifact, {
    ...body,
    stage: 'evaluate_hidden_target',
  }),
);
route('/control/complete-evaluation-stage', 'evaluation', (ctx, body) =>
  ctx.runMutation(internal.workflow.completeStage, { ...body, stage: 'evaluate_hidden_target' }),
);

http.route({
  pathPrefix: '/control/',
  method: 'OPTIONS',
  handler: httpAction(
    async (_ctx, request) => new Response(null, { status: 204, headers: cors(request) }),
  ),
});

function authorize(request: Request, plane: Plane): Response | null {
  const names = {
    owner: 'NODEVIDEO_OWNER_TOKEN',
    worker: 'NODEVIDEO_WORKER_TOKEN',
    evaluation: 'NODEVIDEO_EVALUATION_TOKEN',
  } as const;
  const expected = process.env[names[plane]];
  const supplied = request.headers.get('authorization');
  if (!expected || supplied !== `Bearer ${expected}`) {
    return json({ error: 'unauthorized' }, 401, request);
  }
  return null;
}

function json(value: unknown, status: number, request: Request): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json', ...cors(request) },
  });
}

function cors(request: Request): Record<string, string> {
  const configured = process.env.NODEVIDEO_APP_ORIGIN;
  const origin = request.headers.get('origin');
  const allowed = configured && origin === configured ? origin : (configured ?? 'null');
  return {
    'access-control-allow-origin': allowed,
    'access-control-allow-headers': 'authorization,content-type',
    'access-control-allow-methods': 'POST,OPTIONS',
    vary: 'origin',
  };
}

export default http;
