import { v } from 'convex/values';
import { internalMutation, query } from './_generated/server';
import { assertBoundedString } from './lib/durability';
import { runtimeLayer } from './validators';

function assertSourceSha(sourceSha: string): string {
  if (!/^[0-9a-f]{40,64}$/.test(sourceSha)) throw new Error('invalid_runtime_source_sha');
  return sourceSha;
}

export const upsert = internalMutation({
  args: {
    layer: runtimeLayer,
    sourceSha: v.string(),
    deployment: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const sourceSha = assertSourceSha(args.sourceSha);
    const deployment =
      args.deployment === undefined
        ? undefined
        : assertBoundedString(args.deployment, 256, 'deployment');
    const now = Date.now();
    const existing = await ctx.db
      .query('runtimeSources')
      .withIndex('by_layer', (index) => index.eq('layer', args.layer))
      .unique();
    if (existing !== null) {
      await ctx.db.patch(existing._id, { sourceSha, deployment, updatedAt: now });
      return existing._id;
    }
    return ctx.db.insert('runtimeSources', {
      layer: args.layer,
      sourceSha,
      deployment,
      updatedAt: now,
    });
  },
});

export const get = query({
  args: { layer: runtimeLayer },
  handler: async (ctx, args) => {
    const source = await ctx.db
      .query('runtimeSources')
      .withIndex('by_layer', (index) => index.eq('layer', args.layer))
      .unique();
    if (source === null) return null;
    return {
      layer: source.layer,
      sourceSha: source.sourceSha,
      deployment: source.deployment,
      updatedAt: source.updatedAt,
    };
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const sources = await ctx.db.query('runtimeSources').collect();
    return sources
      .map(({ layer, sourceSha, deployment, updatedAt }) => ({
        layer,
        sourceSha,
        deployment,
        updatedAt,
      }))
      .sort((left, right) => left.layer.localeCompare(right.layer));
  },
});
