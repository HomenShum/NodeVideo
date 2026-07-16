import { rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
for (const name of ['.output', '.nitro']) {
  const target = resolve(root, name);
  if (dirname(target) !== root || target !== join(root, name)) {
    throw new Error(`Refusing to clean outside the Eve package: ${target}`);
  }
  await rm(target, { recursive: true, force: true });
}
