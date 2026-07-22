import { readFile, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

const path = resolve(process.argv[2] ?? '');
if (!path.endsWith('.receipt.json')) throw new Error('Provide an asset .receipt.json path');
if (process.env.NODEVIDEO_PUBLIC_ASSET_APPROVED !== '1') {
  throw new Error(
    'Set NODEVIDEO_PUBLIC_ASSET_APPROVED=1 after completing likeness, trademark, music, and source-rights review',
  );
}
const receipt = JSON.parse(await readFile(path, 'utf8'));
if (receipt.rights?.sourceAssetsOwned !== true) throw new Error('Source ownership is not affirmed');
if (receipt.rights?.thirdPartyMarks === true)
  throw new Error('Third-party marks must be cleared or removed');
receipt.rights.reviewStatus = 'approved';
receipt.rights.publicReleaseApproved = true;
receipt.rights.reviewedAt = new Date().toISOString();
receipt.rights.notes = [
  ...(receipt.rights.notes ?? []),
  'Public release approved through the explicit NodeVideo asset gate.',
];
const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`);
await writeFile(temporary, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
await rename(temporary, path);
console.log(path);
