#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  CREATOR_INTENT_PROFILE_SCHEMA_VERSION,
  validateCreatorIntentProfile,
  validateProductionDecisionLedger,
} from '../../src/lib/production-decision-contracts.ts';

export function learnCreatorIntentProfile({ ledgers, id, learnedAt }) {
  ledgers.forEach(validateProductionDecisionLedger);
  const groups = new Map();
  for (const ledger of ledgers) {
    for (const decision of ledger.decisions) {
      if (decision.evidenceStatus !== 'owner-confirmed' || decision.requiresOwnerReview) continue;
      const key = `${decision.dimension}:${normalize(decision.causalFunction)}`;
      const group = groups.get(key) ?? [];
      group.push({ decision, ledger });
      groups.set(key, group);
    }
  }
  const rules = [];
  for (const group of groups.values()) {
    const productionIds = new Set(group.flatMap(({ ledger }) => ledger.sourceProductionIds));
    if (productionIds.size < 2) continue;
    const first = group[0].decision;
    rules.push({
      id: `intent.${first.dimension}.${slug(first.causalFunction)}`,
      dimension: first.dimension,
      causalFunction: first.causalFunction,
      creatorRule: first.intentHypothesis,
      supportProductions: productionIds.size,
      confidence: round(Math.min(...group.map(({ decision }) => decision.confidence)), 3),
      evidenceArtifactIds: [
        ...new Set(group.flatMap(({ decision }) => decision.evidenceArtifactIds)),
      ],
    });
  }
  const profile = {
    schemaVersion: CREATOR_INTENT_PROFILE_SCHEMA_VERSION,
    id,
    learnedAt,
    sourceLedgerIds: ledgers.map((ledger) => ledger.id),
    rules,
    cautions:
      rules.length > 0
        ? []
        : [
            'No creator rule was promoted: each rule requires owner-confirmed intent in at least two productions.',
          ],
  };
  validateCreatorIntentProfile(profile);
  return profile;
}

function normalize(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function slug(value) {
  return normalize(value).replaceAll(' ', '-').slice(0, 100);
}

function round(value, digits) {
  return Number(value.toFixed(digits));
}

function parseArgs(argv) {
  const inputs = [];
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--') || index + 1 >= argv.length)
      throw new Error(`Invalid argument: ${key}`);
    if (key === '--input') inputs.push(argv[index + 1]);
    else options[key.slice(2)] = argv[index + 1];
    index += 1;
  }
  if (inputs.length === 0) throw new Error('At least one --input ledger is required.');
  if (!options.out) throw new Error('--out is required.');
  return { inputs, options };
}

export function main(argv = process.argv.slice(2)) {
  const { inputs, options } = parseArgs(argv);
  const profile = learnCreatorIntentProfile({
    ledgers: inputs.map((path) => JSON.parse(readFileSync(resolve(path), 'utf8'))),
    id: options['profile-id'] ?? 'creator-intent.learned',
    learnedAt: options['learned-at'] ?? new Date().toISOString(),
  });
  writeFileSync(resolve(options.out), `${JSON.stringify(profile, null, 2)}\n`);
  process.stdout.write(
    `${JSON.stringify({ out: resolve(options.out), promotedRules: profile.rules.length, cautions: profile.cautions })}\n`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
