#!/usr/bin/env node

import {
  generateSongConditionedReplay,
  replayRelative,
  verifySongConditionedReplay,
} from './song-conditioned-auto-edit-lib.mjs';

if (process.argv.includes('--verify-public')) {
  const result = await verifySongConditionedReplay();
  if (!result.passed) {
    throw new Error(
      result.assertions
        .filter((item) => !item.pass)
        .map((item) => item.name)
        .join(', '),
    );
  }
  console.log(`Verified song-conditioned replay (${result.assertions.length} checks).`);
  process.exit(0);
}

if (!process.argv.includes('--public')) {
  throw new Error(
    'Use --public for the deterministic replay or the source-only analysis CLI for private media.',
  );
}

const result = await generateSongConditionedReplay();
if (!result.evaluation.passed) {
  throw new Error(
    result.evaluation.assertions
      .filter((item) => !item.pass)
      .map((item) => item.name)
      .join(', '),
  );
}
console.log(`Generated ${replayRelative(result.paths.preview)}.`);
console.log(`${result.evaluation.assertions.length} evaluator checks passed.`);
