#!/usr/bin/env node

import { join } from 'node:path';
import {
  AUTHORIZED_CASE_ROOT,
  runAuthorizedReferenceReconstruct,
  verifyAuthorizedCase,
} from './reference-reconstruct-lib.mjs';

const args = new Set(process.argv.slice(2));

if (args.has('--verify-public')) {
  const verification = await verifyAuthorizedCase(join(AUTHORIZED_CASE_ROOT, 'receipt.json'));
  if (!verification.passed) {
    throw new Error(
      `Authorized case verification failed: ${verification.assertions
        .filter((item) => !item.pass)
        .map((item) => item.name)
        .join(', ')}`,
    );
  }
  console.log(`Verified ${AUTHORIZED_CASE_ROOT} (${verification.assertions.length} checks)`);
  process.exit(0);
}

if (!args.has('--authorized-public')) {
  throw new Error('Use --authorized-public to generate the owner-authorized case.');
}

const sourceAPath = required('NODEVIDEO_RAW_TAKE_A');
const sourceBPath = required('NODEVIDEO_RAW_TAKE_B');
const targetPath = required('NODEVIDEO_REFERENCE_OUTPUT');
const ownerAuthorized = process.env.NODEVIDEO_OWNER_AUTHORIZED_PUBLICATION === 'true';

const output = await runAuthorizedReferenceReconstruct({
  sourceAPath,
  sourceBPath,
  targetPath,
  ownerAuthorized,
});

console.log(`Authorized case generated at ${output.paths.manifest}`);

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} before generating the authorized case.`);
  return value;
}
