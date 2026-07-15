import { Badge } from '@/components/ui/badge';
import type { PublishedCaseV2PictureClip } from '@/lib/published-case-v2';

interface AudiovisualTimelineProps {
  clips: PublishedCaseV2PictureClip[];
}

export function AudiovisualTimeline({ clips }: AudiovisualTimelineProps) {
  return (
    <section className="space-y-2" aria-labelledby="picture-timeline-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="picture-timeline-title" className="font-medium">
          Picture decisions
        </h3>
        <span className="text-xs text-muted-foreground">Output timeline</span>
      </div>

      <ol className="space-y-2 sm:hidden" data-testid="picture-timeline-mobile">
        {clips.map((clip) => (
          <li className="rounded-lg border p-2" key={clip.id}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{clip.label}</span>
              <Badge variant={clip.passed ? 'outline' : 'destructive'}>
                {clip.passed ? 'Gate passed' : 'Blocked'}
              </Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {formatRange(clip.outputStartSeconds, clip.outputEndSeconds)} · {clip.sourceLabel} ·{' '}
              {clip.framing}
            </p>
          </li>
        ))}
      </ol>

      <ol
        className="hidden min-h-24 w-full overflow-hidden rounded-lg border sm:flex"
        data-testid="picture-timeline-desktop"
      >
        {clips.map((clip) => (
          <li
            className="flex min-w-14 flex-1 flex-col justify-between border-r bg-muted/40 p-2 last:border-r-0"
            key={clip.id}
            title={`${clip.label}: ${formatRange(clip.outputStartSeconds, clip.outputEndSeconds)}`}
          >
            <span className="line-clamp-2 text-xs font-medium">{clip.label}</span>
            <span className="text-xs text-muted-foreground">{clip.framing}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function formatRange(startSeconds: number, endSeconds: number) {
  return `${startSeconds.toFixed(3)}–${endSeconds.toFixed(3)} s`;
}
