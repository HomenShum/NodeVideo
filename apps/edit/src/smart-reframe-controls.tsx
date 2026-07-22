import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { FramingPolicy, ReframeCritic, ReframePlan, SubjectTrack } from '@/lib/smart-reframe';
import { Crosshair, ScanSearch, ShieldCheck } from 'lucide-react';
import type { PointerEvent as ReactPointerEvent } from 'react';

export type SmartReframeView = {
  tracks: SubjectTrack[];
  selectedTrackId?: string;
  plans: ReframePlan[];
  critics: Record<string, ReframeCritic>;
  status: 'idle' | 'analyzing' | 'ready' | 'no-subject' | 'planned' | 'failed';
  progress: number;
  policy: FramingPolicy;
  motionPreset: ReframePlan['intent']['motionPreset'];
};

export function SmartReframeControls(props: {
  view: SmartReframeView;
  selectedAspectRatio?: string;
  editingCrop: boolean;
  onAnalyze: () => void;
  onSelectTrack: (id: string) => void;
  onPolicy: (value: FramingPolicy) => void;
  onMotion: (value: ReframePlan['intent']['motionPreset']) => void;
  onPlan: () => void;
  onToggleEdit: () => void;
}) {
  const selectedPlan =
    props.view.plans.find((plan) => plan.intent.aspectRatio === props.selectedAspectRatio) ??
    props.view.plans[0];
  const critic = selectedPlan ? props.view.critics[selectedPlan.id] : undefined;
  return (
    <section className="smart-reframe-bar" aria-label="Smart Reframe controls">
      <div className="smart-reframe-title">
        <span>
          <Crosshair className="size-3.5" /> Smart Reframe
        </span>
        <small>local pose tracking · no frame egress</small>
      </div>
      <div className="smart-reframe-subjects" aria-label="Detected subjects">
        {props.view.tracks.map((track, index) => (
          <button
            type="button"
            className={props.view.selectedTrackId === track.id ? 'is-selected' : ''}
            onClick={() => props.onSelectTrack(track.id)}
            key={track.id}
          >
            Person {index + 1}
            <small>{Math.round(track.identityContinuity * 100)}% continuity</small>
          </button>
        ))}
        {!props.view.tracks.length && (
          <Button
            size="sm"
            variant="secondary"
            onClick={props.onAnalyze}
            disabled={props.view.status === 'analyzing'}
          >
            <ScanSearch className="size-3.5" />
            {props.view.status === 'analyzing'
              ? `Analyzing ${Math.round(props.view.progress * 100)}%`
              : 'Detect subjects locally'}
          </Button>
        )}
      </div>
      <Select
        value={props.view.policy}
        onValueChange={(value) => props.onPolicy(value as FramingPolicy)}
      >
        <SelectTrigger aria-label="Framing policy" className="h-8 w-[148px] text-[11px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="full-body-safe">Full-body safe</SelectItem>
          <SelectItem value="performance-dynamic">Performance dynamic</SelectItem>
          <SelectItem value="speaker">Speaker</SelectItem>
          <SelectItem value="group-formation">Group formation</SelectItem>
        </SelectContent>
      </Select>
      <Select
        value={props.view.motionPreset}
        onValueChange={(value) => props.onMotion(value as ReframePlan['intent']['motionPreset'])}
      >
        <SelectTrigger aria-label="Crop motion" className="h-8 w-[124px] text-[11px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="stable">Stable</SelectItem>
          <SelectItem value="smooth">Smooth</SelectItem>
          <SelectItem value="responsive">Responsive</SelectItem>
          <SelectItem value="cinematic">Cinematic</SelectItem>
          <SelectItem value="full-body-safe">Full-body safe</SelectItem>
        </SelectContent>
      </Select>
      <Button size="sm" onClick={props.onPlan} disabled={!props.view.selectedTrackId}>
        Generate crop path
      </Button>
      {selectedPlan && (
        <Button
          size="sm"
          variant={props.editingCrop ? 'secondary' : 'outline'}
          onClick={props.onToggleEdit}
        >
          Edit crop path
        </Button>
      )}
      {critic && (
        <Badge variant={critic.verdict === 'pass' ? 'secondary' : 'outline'}>
          <ShieldCheck className="size-3" /> {critic.verdict} ·{' '}
          {Math.round(critic.criticalRegionCoverage * 100)}% critical coverage
        </Badge>
      )}
    </section>
  );
}

export function CropPathOverlay(props: {
  plan?: ReframePlan;
  frame: number;
  editable: boolean;
  onCommit: (box: { x: number; y: number; width: number; height: number }, frame: number) => void;
}) {
  const keyframe = props.plan?.cropKeyframes.reduce((closest, item) =>
    Math.abs(item.timelineFrame - props.frame) < Math.abs(closest.timelineFrame - props.frame)
      ? item
      : closest,
  );
  if (!keyframe) return null;
  const startDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!props.editable) return;
    const element = event.currentTarget;
    const parent = element.parentElement;
    if (!parent) return;
    element.setPointerCapture(event.pointerId);
    const origin = { x: event.clientX, y: event.clientY, box: keyframe.box };
    const move = (moveEvent: PointerEvent) => {
      const bounds = parent.getBoundingClientRect();
      const x = Math.max(
        0,
        Math.min(
          1 - origin.box.width,
          origin.box.x + (moveEvent.clientX - origin.x) / bounds.width,
        ),
      );
      const y = Math.max(
        0,
        Math.min(
          1 - origin.box.height,
          origin.box.y + (moveEvent.clientY - origin.y) / bounds.height,
        ),
      );
      element.style.left = `${x * 100}%`;
      element.style.top = `${y * 100}%`;
      element.dataset.nextBox = JSON.stringify({ ...origin.box, x, y });
    };
    const end = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      const next = element.dataset.nextBox;
      if (next) props.onCommit(JSON.parse(next), props.frame);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end, { once: true });
  };
  return (
    <button
      type="button"
      aria-label={props.editable ? 'Drag crop frame' : 'Crop frame preview'}
      className={`smart-crop-frame ${props.editable ? 'is-editable' : ''}`}
      style={{
        left: `${keyframe.box.x * 100}%`,
        top: `${keyframe.box.y * 100}%`,
        width: `${keyframe.box.width * 100}%`,
        height: `${keyframe.box.height * 100}%`,
      }}
      onPointerDown={startDrag}
    >
      <span>{props.editable ? 'drag · manual keyframe' : 'crop path'}</span>
    </button>
  );
}
