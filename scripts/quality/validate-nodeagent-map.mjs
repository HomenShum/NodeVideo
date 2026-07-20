import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, readFile, readdir } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

async function read(relativePath) {
  return readFile(resolve(root, relativePath), 'utf8');
}

async function requirePath(relativePath, base = root) {
  await access(resolve(base, relativePath));
}

async function requireYamlPathValues(source, base) {
  const references = [
    ...source.matchAll(/(?:^|\s)(\.\.?\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_.-]+)*)\s*$/gm),
  ].map((match) => match[1]);
  for (const reference of new Set(references)) await requirePath(reference, base);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function listFiles(directory) {
  const paths = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = resolve(directory, entry.name);
    if (entry.isDirectory()) paths.push(...(await listFiles(absolute)));
    else paths.push(relative(root, absolute).replaceAll('\\', '/'));
  }
  return paths.sort();
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const manifest = await read('nodeagent.yaml');
assert.match(manifest, /^schemaVersion: nodeagent\.application\/v1$/m);
assert.doesNotMatch(manifest, /^(?:apiVersion|kind|metadata|spec):/m);
assert.match(manifest, /authoring:\s*\n\s+directory: \.\/apps\/eve-agent\/agent/);
assert.match(manifest, /runtime:\s*\n\s+engine: eve\s*\n\s+profile: brownfield-control-plane/);
assert.match(manifest, /adapter: eve-vercel-ai-gateway/);
assert.match(manifest, /provider: openai\s*\n\s+id: gpt-5\.4-mini/);
assert.match(manifest, /secretRef: AI_GATEWAY_API_KEY/);
assert.match(manifest, /- nodevideo-eve-isolation/);
assert.match(manifest, /- nodevideo-eve-live-approvals/);
await requireYamlPathValues(manifest, root);

const evePackage = JSON.parse(await read('apps/eve-agent/package.json'));
assert.equal(evePackage.dependencies.eve, '0.24.4');
const eveAgent = await read('apps/eve-agent/agent/agent.ts');
assert.match(eveAgent, /model: 'openai\/gpt-5\.4-mini'/);

const packPath = 'packs/song-conditioned-auto-edit/pack.yaml';
const pack = await read(packPath);
const packRoot = resolve(root, dirname(packPath));
assert.match(pack, /^schemaVersion: nodeagent\.pack\/v1$/m);
assert.match(pack, /^id: nodevideo-song-conditioned-auto-edit$/m);
await requireYamlPathValues(pack, packRoot);

const legacyPack = JSON.parse(await read('packs/song-conditioned-auto-edit/manifest.json'));
assert.equal(legacyPack.id, 'nodevideo.song-conditioned-auto-edit');
assert.equal(legacyPack.version, '0.1.0');
for (const id of [...legacyPack.outputs, ...legacyPack.tools]) {
  assert.match(
    pack,
    new RegExp(`^\\s+- ${escapeRegex(id)}$`, 'm'),
    `missing mapped pack id: ${id}`,
  );
}

for (const bindingPath of [
  'evals/nodevideo-eve-isolation.json',
  'evals/nodevideo-eve-live-approvals.json',
]) {
  const binding = JSON.parse(await read(bindingPath));
  assert.equal(binding.schemaVersion, 'nodeagent.evaluation-binding/v1');
  assert.match(manifest, new RegExp(`^\\s+- ${escapeRegex(binding.id)}$`, 'm'));
  assert.ok(binding.command.startsWith('npm --prefix apps/eve-agent run '));
  for (const source of binding.sources) await requirePath(source);
}

const compiledHash = (await read('.nodeagent/config-hash.txt')).trim();
const diagnostics = JSON.parse(await read('.nodeagent/diagnostics.json'));
const discovery = JSON.parse(await read('.nodeagent/discovery.json'));
const resolvedDefinition = JSON.parse(await read('.nodeagent/resolved-definition.json'));
assert.deepEqual(diagnostics.errors, []);
assert.equal(compiledHash, resolvedDefinition.configHash);
assert.equal(sha256(manifest), resolvedDefinition.manifestDigest);
assert.equal(resolvedDefinition.runtime.engine, 'eve');
assert.deepEqual(resolvedDefinition.secretRefs, [
  'AI_GATEWAY_API_KEY',
  'NODEVIDEO_EVALUATION_CONTROL_TOKEN',
  'NODEVIDEO_GENERATION_CONTROL_TOKEN',
]);

const discovered = new Map(discovery.files.map((entry) => [entry.path, entry]));
for (const required of [
  ...(await listFiles(resolve(root, 'apps/eve-agent/agent'))),
  'packs/song-conditioned-auto-edit/pack.yaml',
  'evals/nodevideo-eve-isolation.json',
  'evals/nodevideo-eve-live-approvals.json',
]) {
  assert.ok(discovered.has(required), `compiled discovery is missing ${required}`);
}
for (const [relativePath, expected] of discovered) {
  assert.ok(!relativePath.split('/').includes('..'), `unsafe discovery path: ${relativePath}`);
  const content = await readFile(resolve(root, relativePath));
  assert.equal(content.byteLength, expected.bytes, `compiled byte count is stale: ${relativePath}`);
  assert.equal(sha256(content), expected.digest, `compiled digest is stale: ${relativePath}`);
}

const compiledText = [
  await read('.nodeagent/discovery.json'),
  await read('.nodeagent/resolved-definition.json'),
].join('\n');
assert.doesNotMatch(
  compiledText,
  /(?:sk-[A-Za-z0-9_-]{12,}|AIza[A-Za-z0-9_-]{20,}|-----BEGIN [A-Z ]+PRIVATE KEY-----)/,
  'compiled metadata must not contain literal credentials',
);

console.log('NodeVideo Eve brownfield NodeAgent map verified.');
