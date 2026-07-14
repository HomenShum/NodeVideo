import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..', '..');
const policy = JSON.parse(
  fs.readFileSync(path.join(repositoryRoot, '.ui', 'ui-policy.json'), 'utf8'),
);

if (!['ratchet', 'final'].includes(policy.mode)) {
  throw new Error(`Unsupported UI policy mode: ${policy.mode}`);
}

const normalizePath = (value) => value.split(path.sep).join('/');
const relativePath = (value) => normalizePath(path.relative(repositoryRoot, value));
const resolvePolicyPath = (value) => path.resolve(repositoryRoot, value);

function isAtOrBelow(filePath, directoryPath) {
  const relative = path.relative(directoryPath, filePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

const generatedRoots = policy.generatedRoots.map(resolvePolicyPath);
const excludedRoots = policy.excludedRoots.map(resolvePolicyPath);

function isExcluded(filePath) {
  return [...generatedRoots, ...excludedRoots].some((root) => isAtOrBelow(filePath, root));
}

function walk(directoryPath) {
  if (!fs.existsSync(directoryPath)) return [];
  const files = [];
  for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      if (!isExcluded(entryPath)) files.push(...walk(entryPath));
      continue;
    }
    if (entry.isFile()) files.push(entryPath);
  }
  return files;
}

function logicalLines(source) {
  let inBlockComment = false;
  let count = 0;
  for (const rawLine of source.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line) continue;

    while (line) {
      if (inBlockComment) {
        const end = line.indexOf('*/');
        if (end === -1) {
          line = '';
          break;
        }
        inBlockComment = false;
        line = line.slice(end + 2).trim();
        continue;
      }
      if (line.startsWith('//')) {
        line = '';
        break;
      }
      if (line.startsWith('/*')) {
        inBlockComment = true;
        line = line.slice(2);
        continue;
      }
      count += 1;
      break;
    }
  }
  return count;
}

const authoredFiles = policy.authoredRoots
  .flatMap((root) => walk(resolvePolicyPath(root)))
  .filter((file) => /\.[jt]sx$/.test(file));
const uiFileMetrics = authoredFiles.map((filePath) => ({
  file: relativePath(filePath),
  loc: logicalLines(fs.readFileSync(filePath, 'utf8')),
}));
const authoredUiLoc = uiFileMetrics.reduce((total, metric) => total + metric.loc, 0);

const styleMetrics = policy.allowedStyleFiles
  .map(resolvePolicyPath)
  .filter((filePath) => fs.existsSync(filePath))
  .map((filePath) => ({
    file: relativePath(filePath),
    loc: logicalLines(fs.readFileSync(filePath, 'utf8')),
  }));
const authoredCssLoc = styleMetrics.reduce((total, metric) => total + metric.loc, 0);

const domainComponents = policy.domainComponentRoots
  .flatMap((root) => walk(resolvePolicyPath(root)))
  .filter((file) => /\.[jt]sx$/.test(file));

const errors = [];
const warnings = [];
const activeUiBudget =
  policy.mode === 'final' ? policy.finalBudgets.authoredUiLoc : policy.ratchetBudgets.authoredUiLoc;
const activeCssBudget =
  policy.mode === 'final'
    ? policy.finalBudgets.authoredCssLoc
    : policy.ratchetBudgets.authoredCssLoc;
if (authoredUiLoc > activeUiBudget) {
  errors.push(`authored UI is ${authoredUiLoc} LOC; active ceiling is ${activeUiBudget}`);
}
if (authoredCssLoc > activeCssBudget) {
  errors.push(`authored CSS is ${authoredCssLoc} LOC; active ceiling is ${activeCssBudget}`);
}
if (
  policy.mode === 'ratchet' &&
  policy.requireRatchetRefreshOnReduction &&
  authoredUiLoc < policy.ratchetBudgets.authoredUiLoc
) {
  errors.push(
    `authored UI fell to ${authoredUiLoc} LOC; lower the ratchet from ` +
      `${policy.ratchetBudgets.authoredUiLoc}`,
  );
}
if (
  policy.mode === 'ratchet' &&
  policy.requireRatchetRefreshOnReduction &&
  authoredCssLoc < policy.ratchetBudgets.authoredCssLoc
) {
  errors.push(
    `authored CSS fell to ${authoredCssLoc} LOC; lower the ratchet from ` +
      `${policy.ratchetBudgets.authoredCssLoc}`,
  );
}

for (const metric of uiFileMetrics) {
  const legacyCeiling =
    policy.mode === 'ratchet' ? policy.legacyCeilings.authoredUiFiles[metric.file] : undefined;
  const ceiling = legacyCeiling ?? policy.finalBudgets.maxAuthoredUiFileLoc;
  if (metric.loc > ceiling) {
    errors.push(`${metric.file} is ${metric.loc} LOC; its file ceiling is ${ceiling}`);
  } else if (legacyCeiling && metric.loc < legacyCeiling) {
    warnings.push(
      `${metric.file} is now ${metric.loc} LOC; lower its legacy file ceiling from ${legacyCeiling}`,
    );
  }
}

if (domainComponents.length > policy.finalBudgets.maxDomainVisualComponents) {
  errors.push(
    `${domainComponents.length} authored domain component files exist; ` +
      `${policy.finalBudgets.maxDomainVisualComponents} are allowed`,
  );
}

if (policy.mode === 'ratchet' && authoredUiLoc > policy.finalBudgets.authoredUiLoc) {
  warnings.push(
    `${authoredUiLoc - policy.finalBudgets.authoredUiLoc} authored UI LOC remain above the final target`,
  );
}
if (policy.mode === 'ratchet' && authoredCssLoc > policy.finalBudgets.authoredCssLoc) {
  warnings.push(
    `${authoredCssLoc - policy.finalBudgets.authoredCssLoc} authored CSS LOC remain above the final target`,
  );
}

console.log('NodeVideo UI budget');
console.log(
  `  authored UI: ${authoredUiLoc}/${activeUiBudget} active; ` +
    `${policy.finalBudgets.authoredUiLoc} final`,
);
console.log(
  `  authored CSS: ${authoredCssLoc}/${activeCssBudget} active; ` +
    `${policy.finalBudgets.authoredCssLoc} final`,
);
console.log(
  `  domain visual components: ${domainComponents.length}/` +
    `${policy.finalBudgets.maxDomainVisualComponents}`,
);
console.log('  largest authored UI files:');
for (const metric of [...uiFileMetrics].sort((a, b) => b.loc - a.loc).slice(0, 5)) {
  console.log(`    ${metric.loc.toString().padStart(4)}  ${metric.file}`);
}
for (const warning of warnings) console.warn(`WARN: ${warning}`);

if (errors.length > 0) {
  for (const error of errors) console.error(`ERROR: ${error}`);
  process.exitCode = 1;
} else {
  console.log(`PASS: UI code did not exceed the ${policy.mode} budgets.`);
}
