import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { PoseTrack } from '@/lib/integrated-inspector';
import { type ReactNode, type RefObject, useMemo } from 'react';
import { POSE_CONNECTIONS, POSE_LANDMARK_IDS } from './pose-landmarks';

export function EvidenceCard({
  children,
  description,
  title,
}: {
  children: ReactNode;
  description: string;
  title: string;
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export function PoseEvidenceCard({
  description,
  mediaTime,
  track,
}: {
  description: string;
  mediaTime: number;
  track: PoseTrack;
}) {
  return (
    <EvidenceCard description={description} title="Original choreography pose">
      <div className="relative aspect-video bg-zinc-950">
        <PoseSvg
          label="Selected official choreography performer"
          mediaTime={mediaTime}
          track={track}
        />
      </div>
    </EvidenceCard>
  );
}

export function VideoEvidenceCard({
  description,
  mediaTime,
  poseTrack,
  videoRef,
  src,
  title,
  wide = false,
}: {
  description: string;
  mediaTime: number;
  poseTrack?: PoseTrack;
  videoRef: RefObject<HTMLVideoElement | null>;
  src: string;
  title: string;
  wide?: boolean;
}) {
  return (
    <EvidenceCard description={description} title={title}>
      <div
        className={`relative mx-auto overflow-hidden bg-black ${wide ? 'aspect-video w-full' : 'aspect-9/16 max-h-136'}`}
      >
        <video
          className="size-full object-contain"
          muted
          onLoadedMetadata={() => seek(videoRef, mediaTime)}
          playsInline
          preload="metadata"
          ref={videoRef}
          src={src}
        />
        {poseTrack ? (
          <PoseSvg label={`${title} pose`} mediaTime={mediaTime} track={poseTrack} />
        ) : null}
      </div>
    </EvidenceCard>
  );
}

export function seek(ref: RefObject<HTMLVideoElement | null>, time: number) {
  const video = ref.current;
  if (!video || !Number.isFinite(video.duration)) return;
  const bounded = Math.max(0, Math.min(time, Math.max(0, video.duration - 1 / 60)));
  if (Math.abs(video.currentTime - bounded) > 1 / 120) video.currentTime = bounded;
}

function PoseSvg({
  label,
  mediaTime,
  track,
}: { label: string; mediaTime: number; track: PoseTrack }) {
  const sample = useMemo(() => interpolatePose(track, mediaTime), [mediaTime, track]);
  return (
    <svg
      aria-label={label}
      className="absolute inset-0 size-full"
      role="img"
      viewBox="0 0 1000 1000"
      preserveAspectRatio="none"
    >
      <title>{label}</title>
      {POSE_CONNECTIONS.map(([from, to]) => {
        const a = sample.pose[from];
        const b = sample.pose[to];
        return valid(a) && valid(b) ? (
          <line
            className="stroke-brand"
            key={`${from}-${to}`}
            strokeLinecap="round"
            strokeWidth="7"
            x1={a[0] * 1000}
            x2={b[0] * 1000}
            y1={a[1] * 1000}
            y2={b[1] * 1000}
          />
        ) : null;
      })}
      {sample.pose.map((point, index) =>
        valid(point) && (point[2] ?? 0) > 0.25 ? (
          <circle
            className="fill-white stroke-zinc-950"
            cx={point[0] * 1000}
            cy={point[1] * 1000}
            key={POSE_LANDMARK_IDS[index]}
            r="8"
            strokeWidth="3"
          />
        ) : null,
      )}
      <rect fill="rgb(9 9 11 / 0.82)" height="42" rx="10" width="290" x="14" y="14" />
      <text fill="white" fontSize="24" x="28" y="43">
        {sample.interpolated ? '10 Hz · interpolated display' : '10 Hz · measured sample'}
      </text>
    </svg>
  );
}

function interpolatePose(track: PoseTrack, time: number) {
  let right = track.times.findIndex((value) => value >= time);
  if (right === -1) right = track.times.length - 1;
  const left = Math.max(0, right - 1);
  if (right === left || Math.abs(track.times[right] - time) < 0.001)
    return { pose: track.poses[right], interpolated: false };
  const amount = (time - track.times[left]) / (track.times[right] - track.times[left]);
  return {
    interpolated: true,
    pose: track.poses[left].map(
      (point, index) =>
        point.map((value, dimension) => {
          const next = track.poses[right][index][dimension];
          return value == null || next == null ? null : value + (next - value) * amount;
        }) as [number | null, number | null, number | null],
    ),
  };
}

function valid(
  point: [number | null, number | null, number | null],
): point is [number, number, number | null] {
  return point[0] != null && point[1] != null;
}
