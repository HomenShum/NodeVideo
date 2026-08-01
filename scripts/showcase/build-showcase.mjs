import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';

const root = resolve(process.cwd());
const source = resolve(process.argv[2] ?? join(root, 'showcase', 'manifests'));
const destination = resolve(process.argv[3] ?? join(root, '.qa', 'showcase'));

async function jsonFiles(directory) {
  const output = [];
  await mkdir(directory, { recursive: true });
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...(await jsonFiles(path)));
    else if (entry.isFile() && entry.name.endsWith('.json')) output.push(path);
  }
  return output;
}

const manifests = [];
for (const path of await jsonFiles(source)) {
  const manifest = JSON.parse(await readFile(path, 'utf8'));
  if (manifest.schemaVersion !== 'node.showcase-manifest.v1')
    throw new Error(`${path}: unsupported schema`);
  if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length === 0)
    throw new Error(`${path}: no artifacts`);
  for (const artifact of manifest.artifacts) {
    if (
      artifact.receipt?.rights?.reviewStatus !== 'approved' ||
      artifact.receipt?.rights?.publicReleaseApproved !== true
    ) {
      throw new Error(`${path}: ${artifact.id} lacks public rights approval`);
    }
    if (!/^sha256:[a-f\d]{64}$/u.test(artifact.receipt?.output?.sha256 ?? '')) {
      throw new Error(`${path}: ${artifact.id} lacks a valid output hash`);
    }
  }
  manifests.push({ ...manifest, manifestPath: relative(root, path).replaceAll('\\', '/') });
}

const catalog = {
  schemaVersion: 'node.showcase-catalog.v1',
  generatedAt: new Date().toISOString(),
  projects: manifests.sort((left, right) => left.title.localeCompare(right.title)),
};
await mkdir(destination, { recursive: true });
await writeFile(join(destination, 'catalog.json'), `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
const cards = catalog.projects
  .map(
    (project) =>
      `<article><h2>${escapeHtml(project.title)}</h2><p>${escapeHtml(project.summary)}</p><p>${project.artifacts.length} proof-backed artifacts</p></article>`,
  )
  .join('\n');
await writeFile(
  join(destination, 'index.html'),
  `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Node Showcase</title><style>body{font-family:system-ui;background:#09090b;color:#fafafa;margin:0;padding:3rem;max-width:80rem}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(18rem,1fr));gap:1rem}article{border:1px solid #27272a;border-radius:1rem;padding:1.25rem;background:#18181b}p{color:#a1a1aa}</style><h1>Node Showcase</h1><main>${cards}</main></html>`,
  'utf8',
);
console.log(`${catalog.projects.length} showcase projects -> ${destination}`);

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
