import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const evidenceDir = 'evidence/editor-overlay-shared-lane-v5';
const plan = JSON.parse(
  readFileSync('fixtures/media/integrated-source-only-v1/edit-plan.json', 'utf8'),
);
plan.canvas = { width: 180, height: 320 };
plan.durationFrames = 30;
const video = plan.tracks.find((track) => track.kind === 'video' && track.role === 'primary');
video.clips = [
  {
    ...video.clips[0],
    timelineRange: { startFrame: 0, endFrameExclusive: 30 },
    sourceRange: { startFrame: 0, endFrameExclusive: 30 },
  },
];
const overlay = plan.tracks.find((track) => track.kind === 'overlay');
overlay.clips = [{ ...overlay.clips[0], timelineRange: { startFrame: 0, endFrameExclusive: 30 } }];
plan.tracks = plan.tracks.filter((track) => track.kind !== 'audio');
plan.audio = {
  routing: [
    {
      id: 'route.mute.asset.take-a',
      sourceKind: 'asset-audio',
      sourceId: 'asset.take-a',
      bus: 'program',
      muted: true,
      gainDb: 0,
    },
  ],
  events: [{ id: 'event.silence', kind: 'silence', targetStartMs: 0, targetEndMs: 1000 }],
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const mp4Path = `${evidenceDir}/accepted-edited-export.mp4`;
const framePath = `${evidenceDir}/accepted-proof-frame.png`;

try {
  await page.route('**/media/integrated-source-only-v1/edit-plan.json', (route) =>
    route.fulfill({ json: plan }),
  );
  await page.goto('http://127.0.0.1:4173/edit.html');
  await page.getByText('107.7 bpm').waitFor();
  await page.getByLabel('Ask the edit agent').fill('duplicate 0');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Apply to timeline' }).click();
  await page.getByRole('button', { name: 'Edit overlays' }).click();
  await page.getByTestId('overlay-box').first().dispatchEvent('pointerdown');
  await page.getByLabel('Overlay text').fill('PROOF CUT');
  await page.getByLabel('Overlay text').press('Enter');
  await page.getByRole('button', { name: 'Done editing overlays' }).click();
  const download = page.waitForEvent('download', { timeout: 220_000 });
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await (await download).saveAs(mp4Path);
} finally {
  await browser.close();
}

const probe = JSON.parse(
  execFileSync(
    'ffprobe',
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration:stream=codec_name,width,height,codec_type',
      '-of',
      'json',
      mp4Path,
    ],
    { encoding: 'utf8' },
  ),
);
execFileSync('ffmpeg', [
  '-v',
  'error',
  '-ss',
  '0.4',
  '-i',
  mp4Path,
  '-frames:v',
  '1',
  '-vf',
  'scale=720:1280:flags=lanczos',
  '-y',
  framePath,
]);
const ocr = execFileSync('tesseract', [framePath, 'stdout', '--psm', '11'], {
  encoding: 'utf8',
}).trim();
if (!ocr.toUpperCase().includes('PROOF CUT')) throw new Error(`OCR missed accepted text: ${ocr}`);
writeFileSync(
  `${evidenceDir}/accepted-export-receipt.json`,
  `${JSON.stringify(
    {
      acceptedEdits: ['NodeAgent duplicate clip #0', 'Human caption text -> PROOF CUT'],
      probe,
      ocr,
      audioPolicy: 'omitted',
    },
    null,
    2,
  )}\n`,
);
