function parseTimestamp(value) {
  const match = /^(\d{2}):(\d{2}):(\d{2})[,.](\d{3})$/u.exec(value.trim());
  if (!match) return undefined;
  return (
    Number(match[1]) * 3_600_000 +
    Number(match[2]) * 60_000 +
    Number(match[3]) * 1_000 +
    Number(match[4])
  );
}

export function parseSrt(text) {
  const entries = [];
  for (const block of text.replaceAll('\r', '').split(/\n{2,}/u)) {
    const lines = block
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const timingIndex = lines.findIndex((line) => line.includes('-->'));
    if (timingIndex < 0) continue;
    const [startText, endText] = lines[timingIndex].split('-->').map((value) => value.trim());
    const startMs = parseTimestamp(startText);
    const endMs = parseTimestamp(endText);
    const content = lines
      .slice(timingIndex + 1)
      .join(' ')
      .replace(/<[^>]+>/gu, '')
      .replace(/\s+/gu, ' ')
      .trim();
    if (startMs === undefined || endMs === undefined || endMs <= startMs || !content) continue;
    entries.push({ startMs, endMs, text: content });
  }
  return entries;
}

export function clipSrtEntries(entries, sourceOffsetMs, durationMs) {
  const clipEnd = sourceOffsetMs + durationMs;
  return entries
    .filter((entry) => entry.endMs > sourceOffsetMs && entry.startMs < clipEnd)
    .map((entry) => ({
      startMs: Math.max(0, entry.startMs - sourceOffsetMs),
      endMs: Math.min(durationMs, entry.endMs - sourceOffsetMs),
      text: entry.text,
    }))
    .filter((entry) => entry.endMs > entry.startMs);
}

export function wordsFromSrtEntries(entries) {
  return entries.flatMap((entry) => {
    const tokens = entry.text.split(/\s+/u).filter(Boolean);
    const duration = entry.endMs - entry.startMs;
    return tokens.map((text, index) => ({
      text,
      startMs: entry.startMs + (index / tokens.length) * duration,
      endMs: entry.startMs + ((index + 1) / tokens.length) * duration,
      confidence: 1,
    }));
  });
}
