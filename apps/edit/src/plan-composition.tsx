import { AbsoluteFill, Freeze, Sequence, Video, interpolate, useCurrentFrame } from 'remotion';
import type { Plan } from './plan-tools';

export const EDIT_ASSET_URLS: Record<string, string> = {
  'asset.take-a': '/media/authorized-real-v1/source-a-web.mp4',
  'asset.take-b': '/media/authorized-real-v1/source-b-web.mp4',
};

const TEXT_TEMPLATES: Record<
  string,
  { fontScale: number; min: number; max: number; stroke: number }
> = {
  'text.cue': { fontScale: 0.72, min: 18, max: 82, stroke: 3 },
  'text.title': { fontScale: 0.78, min: 22, max: 96, stroke: 4 },
  'text.outro': { fontScale: 0.64, min: 20, max: 76, stroke: 3 },
};

type PlanClip = Plan['tracks'][number]['clips'][number];

function estimateTextWidth(text: string) {
  return Math.max(
    1,
    ...text.split(/\r?\n/u).map((line) =>
      Array.from(line).reduce((width, character) => {
        if (/\s/u.test(character)) return width + 0.33;
        if (/[iIl1|.,'`]/u.test(character)) return width + 0.28;
        if (/[mMwW@#%&]/u.test(character)) return width + 0.86;
        if (/[A-Z]/u.test(character)) return width + 0.62;
        return width + (Number(character.codePointAt(0)) > 0xff ? 0.95 : 0.55);
      }, 0),
    ),
  );
}

function overlayFontSize(clip: PlanClip, plan: Plan) {
  const box = clip.box ?? { x: 0.1, y: 0.8, width: 0.8, height: 0.075 };
  const template = TEXT_TEMPLATES[clip.templateId ?? 'text.cue'] ?? TEXT_TEMPLATES['text.cue'];
  const width = box.width * plan.canvas.width;
  const height = box.height * plan.canvas.height;
  const fitted = Math.floor((width - template.stroke * 2) / estimateTextWidth(clip.text ?? ''));
  return Math.max(
    template.min,
    Math.min(template.max, Math.round(height * template.fontScale), fitted),
  );
}

function TextOverlay({ clip, plan }: { clip: PlanClip; plan: Plan }) {
  const frame = useCurrentFrame();
  const box = clip.box ?? { x: 0.1, y: 0.8, width: 0.8, height: 0.075 };
  const duration = clip.timelineRange.endFrameExclusive - clip.timelineRange.startFrame;
  const animationFrames = Math.max(1, Math.min(6, Math.floor(duration / 2)));
  const entrance = interpolate(frame, [0, animationFrames], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const exit = interpolate(frame, [duration - animationFrames, duration - 1], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const opacity = clip.animation === 'fade' ? Math.min(entrance, exit) : 1;
  const scale = clip.animation === 'pop' ? 0.85 + entrance * 0.15 : 1;
  const slide =
    clip.animation === 'slide-up' ? (1 - entrance) * box.height * plan.canvas.height * 0.35 : 0;
  const template = TEXT_TEMPLATES[clip.templateId ?? 'text.cue'] ?? TEXT_TEMPLATES['text.cue'];

  return (
    <div
      style={{
        position: 'absolute',
        left: `${box.x * 100}%`,
        top: `${box.y * 100}%`,
        width: `${box.width * 100}%`,
        height: `${box.height * 100}%`,
        display: 'grid',
        placeItems: 'center',
        textAlign: 'center',
        color: 'white',
        fontFamily: 'Geist Variable, system-ui, sans-serif',
        fontWeight: 700,
        fontSize: overlayFontSize(clip, plan),
        lineHeight: 1.1,
        textShadow: '2px 2px 2px rgba(0,0,0,0.55)',
        WebkitTextStroke: `${template.stroke}px rgba(0,0,0,0.86)`,
        paintOrder: 'stroke fill',
        opacity,
        transform: `translateY(${slide}px) scale(${scale})`,
      }}
    >
      {clip.text}
    </div>
  );
}

function VideoLayer({ clip, assetUrls }: { clip: PlanClip; assetUrls: Record<string, string> }) {
  const frame = useCurrentFrame();
  const duration = clip.timelineRange.endFrameExclusive - clip.timelineRange.startFrame;
  const src = clip.assetId ? assetUrls[clip.assetId] : undefined;
  const objectFit = clip.fit === 'fit' ? 'contain' : 'cover';
  const keyframes = clip.cropKeyframes ?? [];
  const before =
    [...keyframes].reverse().find((item) => item.timelineFrame <= frame) ?? keyframes[0];
  const after = keyframes.find((item) => item.timelineFrame >= frame) ?? keyframes.at(-1);
  const progress =
    before && after && after.timelineFrame > before.timelineFrame
      ? (frame - before.timelineFrame) / (after.timelineFrame - before.timelineFrame)
      : 0;
  const crop =
    before && after
      ? {
          x: before.box.x + (after.box.x - before.box.x) * progress,
          y: before.box.y + (after.box.y - before.box.y) * progress,
          width: before.box.width + (after.box.width - before.box.width) * progress,
          height: before.box.height + (after.box.height - before.box.height) * progress,
        }
      : undefined;
  const videoStyle = crop
    ? {
        position: 'absolute' as const,
        width: `${100 / crop.width}%`,
        height: `${100 / crop.height}%`,
        left: `${(-crop.x / crop.width) * 100}%`,
        top: `${(-crop.y / crop.height) * 100}%`,
        objectFit: 'fill' as const,
      }
    : { width: '100%', height: '100%', objectFit };

  if (clip.kind === 'black') {
    return (
      <Sequence durationInFrames={duration} from={clip.timelineRange.startFrame}>
        <AbsoluteFill style={{ backgroundColor: 'black' }} />
      </Sequence>
    );
  }
  if (clip.kind === 'freeze' && src && typeof clip.sourceFrame === 'number') {
    return (
      <Sequence durationInFrames={duration} from={clip.timelineRange.startFrame}>
        <Freeze frame={0}>
          <Video muted src={src} startFrom={clip.sourceFrame} style={videoStyle} />
        </Freeze>
      </Sequence>
    );
  }
  if (clip.kind !== 'source' || !src || !clip.sourceRange) return null;
  return (
    <Sequence durationInFrames={duration} from={clip.timelineRange.startFrame}>
      <Video muted src={src} startFrom={clip.sourceRange.startFrame} style={videoStyle} />
    </Sequence>
  );
}

export function PlanComposition({
  plan,
  assetUrls = EDIT_ASSET_URLS,
}: {
  plan: Plan;
  assetUrls?: Record<string, string>;
}) {
  const video = plan.tracks.find((track) => track.kind === 'video');
  const overlays = plan.tracks
    .filter((track) => track.kind === 'overlay')
    .flatMap((track) => track.clips)
    .filter((clip) => clip.kind === 'text' && clip.text);

  return (
    <AbsoluteFill style={{ backgroundColor: '#0c0e0a' }}>
      {video?.clips.map((clip) => (
        <VideoLayer assetUrls={assetUrls} clip={clip} key={clip.id} />
      ))}
      {overlays.map((clip) => (
        <Sequence
          durationInFrames={clip.timelineRange.endFrameExclusive - clip.timelineRange.startFrame}
          from={clip.timelineRange.startFrame}
          key={clip.id}
        >
          <TextOverlay clip={clip} plan={plan} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}
