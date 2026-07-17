import { Artifact, ArtifactHeader, ArtifactTitle } from '@/components/ai-elements/artifact';
import { Button } from '@/components/ui/button';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Item } from '@/components/ui/item';
import { Progress } from '@/components/ui/progress';
import type { JobSnapshot } from '@/lib/live-control-api';
import { Check, Circle, LockKeyhole, RotateCcw, Upload, X } from 'lucide-react';
import type { Dispatch, FormEvent, SetStateAction } from 'react';

export type InputKey = 'reference' | 'takeA' | 'takeB' | 'song' | 'lyrics' | 'creatorProfile';
type UploadInput = {
  key: InputKey;
  label: string;
  accept: string;
  role: string;
  optional?: boolean;
};

export const INPUTS: UploadInput[] = [
  {
    key: 'reference',
    label: 'Original choreography',
    accept: 'video/*',
    role: 'choreography-reference',
  },
  { key: 'takeA', label: 'Creator take A', accept: 'video/*', role: 'creator-take-a' },
  { key: 'takeB', label: 'Creator take B', accept: 'video/*', role: 'creator-take-b' },
  { key: 'song', label: 'Chosen song', accept: 'audio/*,video/*', role: 'chosen-song' },
  { key: 'lyrics', label: 'Timed lyrics', accept: '.json,.lrc,.srt,text/*', role: 'timed-lyrics' },
  {
    key: 'creatorProfile',
    label: 'Creator taste profile (optional)',
    accept: '.json,application/json',
    role: 'creator-taste-profile',
    optional: true,
  },
];

type UploadProps = {
  token: string;
  setToken: (value: string) => void;
  files: Partial<Record<InputKey, File>>;
  setFiles: Dispatch<SetStateAction<Partial<Record<InputKey, File>>>>;
  busy: boolean;
  canStart: boolean;
  onSubmit: (event: FormEvent) => void;
};

export function UploadInputs(props: UploadProps) {
  return (
    <form className="space-y-5" onSubmit={props.onSubmit}>
      <Field>
        <FieldLabel htmlFor="owner-token">Owner access key</FieldLabel>
        <Input
          id="owner-token"
          type="password"
          autoComplete="off"
          value={props.token}
          onChange={(event) => props.setToken(event.target.value)}
        />
      </Field>
      <FieldGroup className="grid gap-4 sm:grid-cols-2">
        {INPUTS.map(({ key, label, accept }) => (
          <Field key={key}>
            <FieldLabel htmlFor={`file-${key}`}>{label}</FieldLabel>
            <Input
              id={`file-${key}`}
              type="file"
              accept={accept}
              onChange={(event) =>
                props.setFiles((current) => ({ ...current, [key]: event.target.files?.[0] }))
              }
            />
          </Field>
        ))}
      </FieldGroup>
      <Button disabled={!props.canStart || props.busy} type="submit">
        <Upload aria-hidden="true" />
        {props.busy ? 'Hashing and uploading...' : 'Start source-only job'}
      </Button>
    </form>
  );
}

type StageProps = {
  snapshot: JobSnapshot | null;
  jobId: string;
  busy: boolean;
  onApprove: () => void;
  onRetry: (stage: string) => void;
};

export function StageView(props: StageProps) {
  const complete =
    props.snapshot?.stages.filter((stage) => stage.status === 'completed').length ?? 0;
  const total = props.snapshot?.stages.length ?? 19;
  const preview = props.snapshot?.artifacts.find(
    (artifact) => artifact.kind === 'preview' && artifact.url,
  );
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>
            {complete} of {total} durable stages
          </span>
          <span className="break-all font-mono text-xs text-muted-foreground">{props.jobId}</span>
        </div>
        <Progress value={(complete / total) * 100} aria-label="Durable job progress" />
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {props.snapshot?.stages.map((stage) => (
          <Item className="min-w-0" key={stage._id} size="sm" variant="outline">
            <StageIcon status={stage.status} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{stage.name.replaceAll('_', ' ')}</p>
              <p className="text-xs text-muted-foreground">
                {stage.status} / attempt {stage.attempt}/{stage.maxAttempts}
              </p>
              {stage.error && <p className="mt-1 text-xs text-destructive">{stage.error}</p>}
            </div>
            {stage.status === 'failed' && (
              <Button
                aria-label={`Retry ${stage.name}`}
                size="icon-sm"
                variant="ghost"
                disabled={props.busy}
                onClick={() => props.onRetry(stage.name)}
              >
                <RotateCcw aria-hidden="true" />
              </Button>
            )}
          </Item>
        ))}
      </div>
      {props.snapshot?.job.currentStage === 'await_review' && (
        <Button onClick={props.onApprove} disabled={props.busy}>
          Approve preview and freeze
        </Button>
      )}
      {preview?.url && (
        // biome-ignore lint/a11y/useMediaCaption: music-only preview with separate timed lyrics artifact
        <video
          className="mx-auto max-h-svh rounded-xl border bg-black"
          controls
          playsInline
          src={preview.url}
        />
      )}
      {props.snapshot?.artifacts.length ? (
        <div className="grid gap-3 border-t pt-5 sm:grid-cols-2">
          {props.snapshot.artifacts.map((artifact) => (
            <Artifact key={artifact._id}>
              <ArtifactHeader>
                <div className="min-w-0">
                  <ArtifactTitle className="truncate">{artifact.artifactKey}</ArtifactTitle>
                </div>
              </ArtifactHeader>
            </Artifact>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function StageIcon({ status }: { status: JobSnapshot['stages'][number]['status'] }) {
  if (status === 'completed')
    return <Check className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden="true" />;
  if (status === 'failed' || status === 'cancelled')
    return <X className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />;
  if (status === 'awaiting_approval')
    return <LockKeyhole className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden="true" />;
  return <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />;
}
