import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..', '..');
const policyPath = path.join(repositoryRoot, '.ui', 'ui-policy.json');
const policySource = fs.readFileSync(policyPath, 'utf8');
const policySourceFile = ts.parseJsonText(policyPath, policySource);
const duplicatePolicyKeys = [];

function findDuplicateJsonKeys(node) {
  if (ts.isObjectLiteralExpression(node)) {
    const seen = new Map();
    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property)) continue;
      const name = property.name;
      const key =
        ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)
          ? name.text
          : name.getText(policySourceFile);
      const line =
        policySourceFile.getLineAndCharacterOfPosition(name.getStart(policySourceFile)).line + 1;
      if (seen.has(key)) {
        duplicatePolicyKeys.push(`${key} at lines ${seen.get(key)} and ${line}`);
      } else {
        seen.set(key, line);
      }
    }
  }
  ts.forEachChild(node, findDuplicateJsonKeys);
}

findDuplicateJsonKeys(policySourceFile);
if (policySourceFile.parseDiagnostics.length > 0) {
  throw new Error(
    `Invalid .ui/ui-policy.json: ${policySourceFile.parseDiagnostics[0].messageText}`,
  );
}
if (duplicatePolicyKeys.length > 0) {
  throw new Error(`Duplicate .ui/ui-policy.json keys: ${duplicatePolicyKeys.join('; ')}`);
}

const policy = JSON.parse(policySource);

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

function walkGenerated(directoryPath) {
  if (!fs.existsSync(directoryPath)) return [];
  const files = [];
  for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) files.push(...walkGenerated(entryPath));
    else if (entry.isFile()) files.push(entryPath);
  }
  return files;
}

function normalizedSha256(filePath) {
  const source = fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
  return crypto.createHash('sha256').update(source).digest('hex');
}

function currentGeneratedManifest() {
  return Object.fromEntries(
    generatedRoots
      .flatMap(walkGenerated)
      .map((filePath) => [relativePath(filePath), normalizedSha256(filePath)])
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function validateGeneratedManifest(actualManifest) {
  const errors = [];
  const expectedManifest = policy.generatedFiles ?? {};
  for (const [file, hash] of Object.entries(actualManifest)) {
    if (!expectedManifest[file]) {
      errors.push(`generated file ${file} is not recorded in the manifest`);
    } else if (expectedManifest[file] !== hash) {
      errors.push(`generated file ${file} differs from its recorded upstream snapshot`);
    }
  }
  for (const file of Object.keys(expectedManifest)) {
    if (!actualManifest[file]) errors.push(`recorded generated file ${file} is missing`);
  }
  return errors;
}

function validateGeneratedSource() {
  const errors = [];
  const source = policy.generatedSource;
  const lockPath = path.join(repositoryRoot, 'package-lock.json');
  if (!fs.existsSync(resolvePolicyPath(source.componentsConfig))) {
    errors.push(`missing generated-component config ${source.componentsConfig}`);
  }
  if (!fs.existsSync(lockPath)) return [...errors, 'package-lock.json is required'];
  const packageLock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  const installedVersion = packageLock.packages?.[`node_modules/${source.cliPackage}`]?.version;
  if (installedVersion !== source.cliVersion) {
    errors.push(
      `${source.cliPackage} resolved to ${installedVersion ?? 'nothing'}; ` +
        `the recorded generator is ${source.cliVersion}`,
    );
  }
  return errors;
}

function lineNumber(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function attributeByName(node, name) {
  return node.attributes.properties.find(
    (attribute) => ts.isJsxAttribute(attribute) && attribute.name.text === name,
  );
}

function staticAttributeText(attribute) {
  if (!attribute?.initializer) return undefined;
  if (ts.isStringLiteral(attribute.initializer)) return attribute.initializer.text;
  if (!ts.isJsxExpression(attribute.initializer) || !attribute.initializer.expression) {
    return undefined;
  }
  const expression = attribute.initializer.expression;
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    return expression.text;
  }
  return undefined;
}

function hasBooleanAttribute(node, name) {
  const attribute = attributeByName(node, name);
  return Boolean(attribute && !attribute.initializer);
}

function tagName(node) {
  return ts.isIdentifier(node.tagName) ? node.tagName.text : undefined;
}

function hasLabelAncestor(node) {
  let current = node.parent;
  while (current) {
    if (ts.isJsxElement(current) && tagName(current.openingElement) === 'label') return true;
    current = current.parent;
  }
  return false;
}

function isAllowedFileInput(node) {
  if (tagName(node) !== 'input') return false;
  const type = staticAttributeText(attributeByName(node, 'type'))?.toLowerCase();
  if (type !== 'file') return false;
  let isHidden = hasBooleanAttribute(node, 'hidden');
  const className = staticAttributeText(attributeByName(node, 'className')) ?? '';
  const tokens = new Set(className.split(/\s+/).filter(Boolean));
  isHidden ||= policy.hiddenFileInput.classTokens.some((token) => tokens.has(token));
  if (!isHidden) return false;
  return !policy.hiddenFileInput.requireLabelAncestor || hasLabelAncestor(node);
}

function labelContainsAllowedFileInput(openingElement) {
  if (!ts.isJsxElement(openingElement.parent)) return false;
  let found = false;
  const visit = (node) => {
    if (found) return;
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      isAllowedFileInput(node)
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  for (const child of openingElement.parent.children) visit(child);
  return found;
}

function isAllowedRawControl(node) {
  const name = tagName(node);
  if (policy.allowedMediaElements.includes(name)) return true;
  if (name === 'input') return isAllowedFileInput(node);
  if (name === 'label') return labelContainsAllowedFileInput(node);
  return false;
}

function isCssVariableOnlyStyle(attribute) {
  if (!policy.allowInlineCssVariables) return false;
  if (!attribute.initializer || !ts.isJsxExpression(attribute.initializer)) return false;
  const expression = attribute.initializer.expression;
  if (
    !expression ||
    !ts.isObjectLiteralExpression(expression) ||
    expression.properties.length === 0
  ) {
    return false;
  }
  return expression.properties.every((property) => {
    if (!ts.isPropertyAssignment(property)) return false;
    const name = property.name;
    const text =
      ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)
        ? name.text
        : ts.isIdentifier(name)
          ? name.text
          : undefined;
    return text?.startsWith('--');
  });
}

function validateExceptions() {
  const errors = [];
  const today = new Date();
  for (const exception of policy.exceptions) {
    const required = [
      'id',
      'owner',
      'reason',
      'created',
      'expires',
      'paths',
      'primitivesChecked',
      'tests',
      'allowances',
    ];
    for (const key of required) {
      if (exception[key] === undefined)
        errors.push(`${exception.id ?? 'unknown'} is missing ${key}`);
    }
    if (exception.paths?.some((value) => /[*?\[\]]/.test(value))) {
      errors.push(`${exception.id} must use exact paths, not glob patterns`);
    }
    for (const [rule, allowance] of Object.entries(exception.allowances ?? {})) {
      if (!Number.isInteger(allowance) || allowance < 1) {
        errors.push(`${exception.id} allowance for ${rule} must be a positive integer`);
      }
    }
    const created = new Date(`${exception.created}T00:00:00Z`);
    const expires = new Date(`${exception.expires}T00:00:00Z`);
    if (Number.isNaN(created.valueOf()) || Number.isNaN(expires.valueOf())) {
      errors.push(`${exception.id} has an invalid created or expires date`);
      continue;
    }
    const lifetimeDays = (expires.valueOf() - created.valueOf()) / 86_400_000;
    if (lifetimeDays > 60) errors.push(`${exception.id} lasts longer than 60 days`);
    const expiresAtEndOfDay = new Date(`${exception.expires}T23:59:59Z`);
    if (expiresAtEndOfDay < today) errors.push(`${exception.id} expired on ${exception.expires}`);
  }
  return errors;
}

function exceptionAllowance(rule, file) {
  return policy.exceptions.reduce((total, exception) => {
    if (!exception.paths.includes(file)) return total;
    const allowance = exception.allowances?.[rule];
    return total + (Number.isInteger(allowance) && allowance > 0 ? allowance : 0);
  }, 0);
}

function selectorBody(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return source.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 's'))?.[1];
}

function validateThemeContract(authoredSourceFiles) {
  const errors = [];
  const contract = policy.themeContract;
  if (!contract || contract.strategy !== 'class') {
    return ['themeContract.strategy must be "class"'];
  }

  const stylePath = resolvePolicyPath(contract.globalStyleFile);
  if (!fs.existsSync(stylePath)) return [`missing theme file ${contract.globalStyleFile}`];
  const styles = fs.readFileSync(stylePath, 'utf8');
  const sourceBase = contract.tailwindSourceBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const sourceImport = new RegExp(
    `@import\\s+["']tailwindcss["']\\s+source\\(["']${sourceBase}["']\\)\\s*;`,
  );
  if (!sourceImport.test(styles)) {
    errors.push(
      `${contract.globalStyleFile} must pin Tailwind source detection to ` +
        `${contract.tailwindSourceBase}`,
    );
  }
  const rootBody = selectorBody(styles, ':root') ?? '';
  const themeSelector = `.${contract.className}`;
  const themeBody = selectorBody(styles, themeSelector);

  if (!themeBody) errors.push(`${contract.globalStyleFile} must define ${themeSelector}`);
  if (/color-scheme\s*:\s*dark\b/.test(rootBody)) {
    errors.push(
      `${contract.globalStyleFile} sets color-scheme: dark in :root; ` +
        `the ${themeSelector} theme must own it`,
    );
  }
  if (themeBody && !/color-scheme\s*:\s*dark\b/.test(themeBody)) {
    errors.push(`${themeSelector} must declare color-scheme: dark`);
  }
  if (!styles.includes(`${contract.brandAccentToken}:`)) {
    errors.push(`declare product branding as ${contract.brandAccentToken}`);
  }

  const semanticUse = `var(${contract.reservedSemanticAccentToken})`;
  for (const [index, line] of styles.split(/\r?\n/).entries()) {
    if (!line.includes(semanticUse)) continue;
    if (/^\s*--[a-z0-9-]+\s*:/i.test(line)) continue;
    errors.push(
      `${contract.globalStyleFile}:${index + 1} uses reserved ${semanticUse}; ` +
        `product branding must use var(${contract.brandAccentToken})`,
    );
  }

  const indexPath = path.join(repositoryRoot, 'index.html');
  const indexSource = fs.existsSync(indexPath) ? fs.readFileSync(indexPath, 'utf8') : '';
  const classPattern = new RegExp(
    `<html[^>]*class=["'][^"']*\\b${contract.className}\\b[^"']*["']`,
    'i',
  );
  const runtimePattern = new RegExp(
    `document\\.documentElement\\.classList\\.(?:add|toggle)\\(\\s*["']${contract.className}["']`,
  );
  const runtimeSource = authoredSourceFiles
    .map((filePath) => fs.readFileSync(filePath, 'utf8'))
    .join('\n');
  if (!classPattern.test(indexSource) && !runtimePattern.test(runtimeSource)) {
    errors.push(
      `the ${contract.className} theme is defined but not mounted on document.documentElement`,
    );
  }
  return errors;
}

const findings = new Map();
function record(rule, file, line, detail) {
  const key = `${rule}\0${file}`;
  const current = findings.get(key) ?? { rule, file, occurrences: [] };
  current.occurrences.push({ line, detail });
  findings.set(key, current);
}

const authoredFiles = policy.authoredRoots
  .flatMap((root) => walk(resolvePolicyPath(root)))
  .filter((file) => /\.[cm]?[jt]sx?$/.test(file));

const generatedManifest = currentGeneratedManifest();
if (process.argv.includes('--print-generated-manifest')) {
  console.log(JSON.stringify(generatedManifest, null, 2));
  process.exit(0);
}

for (const filePath of authoredFiles) {
  const file = relativePath(filePath);
  const sourceText = fs.readFileSync(filePath, 'utf8');
  const scriptKind = /x$/.test(path.extname(filePath)) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(
    file,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );
  const dynamicControlTags = new Map();
  const collectDynamicControlTags = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isStringLiteral(node.initializer) &&
      policy.genericControlTags.includes(node.initializer.text)
    ) {
      dynamicControlTags.set(node.name.text, node.initializer.text);
    }
    ts.forEachChild(node, collectDynamicControlTags);
  };
  collectDynamicControlTags(sourceFile);

  const visit = (node) => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      const arbitraryValues = node.text.match(/\S*\[[^\]\r\n]+\]\S*/g) ?? [];
      for (const value of arbitraryValues) {
        if (/^(?:(?:group|peer)-)?(?:aria|data)-\[[^\]]+\]:[^\[]+$/.test(value)) continue;
        record('arbitrary-tailwind-value', file, lineNumber(sourceFile, node), value);
      }
    }

    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const specifier = node.moduleSpecifier.text;
      if (
        policy.blockedDirectImportPrefixes.some(
          (prefix) => specifier === prefix || specifier.startsWith(prefix),
        )
      ) {
        record('direct-primitive-import', file, lineNumber(sourceFile, node), specifier);
      }
      if (
        policy.blockedStyleImportPrefixes.some(
          (prefix) => specifier === prefix || specifier.startsWith(prefix),
        )
      ) {
        record('css-in-js-import', file, lineNumber(sourceFile, node), specifier);
      }
    }

    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const name = tagName(node);
      if (name && policy.genericControlTags.includes(name) && !isAllowedRawControl(node)) {
        record('raw-generic-control', file, lineNumber(sourceFile, node), `<${name}>`);
      }
      if (name && dynamicControlTags.has(name)) {
        record(
          'raw-generic-control',
          file,
          lineNumber(sourceFile, node),
          `<${name}> resolves to <${dynamicControlTags.get(name)}>`,
        );
      }
      const role = staticAttributeText(attributeByName(node, 'role'));
      if (['button', 'checkbox', 'radio', 'switch', 'tab'].includes(role)) {
        record('raw-generic-control', file, lineNumber(sourceFile, node), `role="${role}"`);
      }
      if (name === 'style') {
        record('authored-style-tag', file, lineNumber(sourceFile, node), '<style>');
      }

      const style = attributeByName(node, 'style');
      if (style && !isCssVariableOnlyStyle(style)) {
        record('inline-style', file, lineNumber(sourceFile, style), 'non-token inline style');
      }
    }

    if (ts.isCallExpression(node) && node.arguments.length > 0) {
      const callee = node.expression;
      const isCreateElement =
        (ts.isIdentifier(callee) && callee.text === 'createElement') ||
        (ts.isPropertyAccessExpression(callee) &&
          ts.isIdentifier(callee.expression) &&
          callee.expression.text === 'React' &&
          callee.name.text === 'createElement');
      const firstArgument = node.arguments[0];
      if (isCreateElement && ts.isStringLiteral(firstArgument)) {
        const name = firstArgument.text;
        if (policy.genericControlTags.includes(name)) {
          record(
            'raw-generic-control',
            file,
            lineNumber(sourceFile, node),
            `createElement('${name}')`,
          );
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

const allowedStyleFiles = new Set(policy.allowedStyleFiles.map(normalizePath));
for (const root of policy.authoredRoots) {
  for (const filePath of walk(resolvePolicyPath(root))) {
    if (!/\.(css|less|sass|scss|styl)$/.test(path.extname(filePath))) continue;
    const file = relativePath(filePath);
    if (!allowedStyleFiles.has(file)) {
      record('unauthorized-css-file', file, 1, 'only configured global style files are allowed');
      continue;
    }
    const source = fs.readFileSync(filePath, 'utf8');
    for (const match of source.matchAll(/@media\b/g)) {
      const line = source.slice(0, match.index).split(/\r?\n/).length;
      record('authored-media-query', file, line, '@media');
    }
  }
}

const errors = [
  ...validateExceptions(),
  ...validateGeneratedSource().map((error) => `generated-provenance: ${error}`),
  ...validateGeneratedManifest(generatedManifest).map((error) => `generated-provenance: ${error}`),
  ...validateThemeContract(authoredFiles).map((error) => `theme-authority: ${error}`),
];
const warnings = [];
const legacyRuleMap = {
  'raw-generic-control': policy.legacyCeilings.rawGenericControls,
  'inline-style': policy.legacyCeilings.inlineStyles,
  'authored-media-query': policy.legacyCeilings.authoredMediaQueries,
};

for (const finding of findings.values()) {
  const legacyAllowance =
    policy.mode === 'ratchet' ? (legacyRuleMap[finding.rule]?.[finding.file] ?? 0) : 0;
  const approvedAllowance = exceptionAllowance(finding.rule, finding.file);
  const allowance = legacyAllowance + approvedAllowance;
  if (finding.occurrences.length > allowance) {
    const examples = finding.occurrences
      .slice(0, 5)
      .map((item) => `${finding.file}:${item.line} ${item.detail}`)
      .join('; ');
    errors.push(
      `${finding.rule}: ${finding.occurrences.length} occurrence(s) in ${finding.file}, ` +
        `${allowance} allowed. ${examples}`,
    );
  } else if (legacyAllowance > 0 && finding.occurrences.length < legacyAllowance) {
    const message =
      `${finding.file} reduced ${finding.rule} from ${legacyAllowance} to ` +
      `${finding.occurrences.length}; lower the ratchet in .ui/ui-policy.json.`;
    if (policy.requireRatchetRefreshOnReduction) errors.push(message);
    else warnings.push(message);
  }
}

for (const [rule, legacyByFile] of Object.entries(legacyRuleMap)) {
  if (policy.mode !== 'ratchet') break;
  for (const [file, allowance] of Object.entries(legacyByFile)) {
    const finding = findings.get(`${rule}\0${file}`);
    if (!finding && allowance > 0) {
      const message = `${file} eliminated ${rule}; set its legacy allowance to 0 or remove it.`;
      if (policy.requireRatchetRefreshOnReduction) errors.push(message);
      else warnings.push(message);
    }
  }
}

console.log('NodeVideo UI policy');
console.log(`  authored source files checked: ${authoredFiles.length}`);
console.log(`  generated roots excluded: ${policy.generatedRoots.join(', ')}`);
console.log(
  `  generated files verified: ${Object.keys(generatedManifest).length} ` +
    `(${policy.generatedSource.cliPackage}@${policy.generatedSource.cliVersion})`,
);
console.log(`  approved exceptions: ${policy.exceptions.length}`);
for (const warning of warnings) console.warn(`WARN: ${warning}`);

if (errors.length > 0) {
  for (const error of errors) console.error(`ERROR: ${error}`);
  process.exitCode = 1;
} else {
  console.log('PASS: no primitive-first policy regression detected.');
}
