import fs from 'node:fs';
import { cp, rm } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const buildsRoot = resolve(root, '.eve', 'builds');
const finalOutput = resolve(root, '.output');
const nativeRename = fs.promises.rename.bind(fs.promises);

if (process.platform === 'win32') {
  fs.promises.rename = async (source, destination) => {
    try {
      return await nativeRename(source, destination);
    } catch (error) {
      const from = resolve(String(source));
      const to = resolve(String(destination));
      const fromRelative = relative(buildsRoot, from);
      const isStagedBuild =
        !fromRelative.startsWith('..') &&
        fromRelative.split(sep).length === 2 &&
        fromRelative.endsWith(`${sep}output`);
      if (error?.code !== 'EPERM' || !isStagedBuild || to !== finalOutput) throw error;

      // eve@0.24.4's Nitro publisher can keep its staged directory open long
      // enough for Windows rename to fail. Preserve the same publication
      // semantics with a scoped copy, then remove only the verified staging dir.
      await rm(to, { recursive: true, force: true });
      await cp(from, to, { recursive: true, errorOnExist: true });
      await rm(from, { recursive: true, force: true });
    }
  };
  syncBuiltinESMExports();
}

const cliPath = join(root, 'node_modules', 'eve', 'dist', 'src', 'cli', 'run.js');
const { runCli } = await import(pathToFileURL(cliPath).href);
await runCli(['build']);
