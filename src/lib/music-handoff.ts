import type { PublishedBlindPilotManifest } from './published-blind-pilot';

const heights = ['h-2', 'h-4', 'h-3', 'h-6', 'h-4', 'h-5', 'h-3', 'h-6'] as const;

export function formatTimestamp(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${(seconds - minutes * 60).toFixed(3).padStart(6, '0')}`;
}

export function buildInstagramCueSheet(manifest: PublishedBlindPilotManifest) {
  const handoff = manifest.musicHandoff;
  return [
    `Search Instagram audio: ${handoff.searchQuery}`,
    `Locate by ear: ${formatTimestamp(handoff.referenceStartSeconds)}–${formatTimestamp(handoff.referenceEndSeconds)} is only a catalog-preview reference, not an Instagram or full-track timestamp (${handoff.referenceCue}).`,
    ...handoff.anchors.map(
      (anchor) =>
        `${formatTimestamp(anchor.videoSeconds)} video → ${formatTimestamp(anchor.referenceSeconds)} catalog preview reference — desired alignment: ${anchor.label}`,
    ),
    ...manifest.instagramHandoff.steps,
  ].join('\n');
}

export function buildWaveform(trackDuration: number, start: number, end: number) {
  return Array.from({ length: 40 }, (_, index) => {
    const seconds = (index / 39) * trackDuration;
    return {
      active: seconds >= start && seconds <= end,
      height: heights[index % heights.length],
      index,
    };
  });
}
