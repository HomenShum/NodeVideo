import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  type InputKey,
  REQUIRED,
  StageView,
  UploadInputs,
} from '@/features/nodevideo/live-job-views';
import {
  type JobSnapshot,
  controlCall,
  sha256File,
  sha256Json,
  uploadFile,
} from '@/lib/live-control-api';
import { type FormEvent, useEffect, useState } from 'react';

export function LiveJobWorkspace() {
  const [token, setToken] = useState(() => sessionStorage.getItem('nodevideo.owner-token') ?? '');
  const [files, setFiles] = useState<Partial<Record<InputKey, File>>>({});
  const [jobId, setJobId] = useState(() => sessionStorage.getItem('nodevideo.job-id'));
  const [snapshot, setSnapshot] = useState<JobSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!jobId || !token) return;
    let active = true;
    const refresh = async () => {
      try {
        const value = await controlCall<JobSnapshot>(token, 'read-job', { jobId });
        if (active) setSnapshot(value);
      } catch (reason) {
        if (active) setError(message(reason, 'Could not read the job.'));
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 2500);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [jobId, token]);

  const canStart = token.length > 8 && REQUIRED.every(({ key }) => files[key]);
  async function start(event: FormEvent) {
    event.preventDefault();
    if (!canStart) return;
    setBusy(true);
    setError(undefined);
    try {
      sessionStorage.setItem('nodevideo.owner-token', token);
      const bindings = await Promise.all(
        REQUIRED.map(async ({ key, role }) => {
          const file = files[key];
          if (!file) throw new Error(`${role} is missing.`);
          return { role, file, sha256: await sha256File(file) };
        }),
      );
      const traceId = `trace.${crypto.randomUUID()}`;
      const input = {
        schemaVersion: 'nodevideo.source-only-case/v1',
        traceId,
        assets: bindings.map(({ role, file, sha256 }) => ({ role, name: file.name, sha256 })),
        isolation: { hiddenTargetAdmitted: false },
      };
      const inputDigest = await sha256Json(input);
      const { caseId } = await controlCall<{ caseId: string }>(token, 'create-source-only-case', {
        projectId: 'nodevideo.owner-proof',
        idempotencyKey: traceId,
        inputDigest,
        input,
      });
      for (const binding of bindings) {
        const storageId = await uploadFile(token, binding.file);
        await controlCall(token, 'admit-asset', {
          caseId,
          role: binding.role,
          storageId,
          sha256: binding.sha256,
          mimeType: binding.file.type || 'application/octet-stream',
          sizeBytes: binding.file.size,
        });
      }
      const started = await controlCall<{ jobId: string }>(token, 'start-job', {
        caseId,
        idempotencyKey: `job.${traceId}`,
        inputDigest,
      });
      sessionStorage.setItem('nodevideo.job-id', started.jobId);
      setJobId(started.jobId);
    } catch (reason) {
      setError(message(reason, 'Could not start the job.'));
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    if (!jobId) return;
    setBusy(true);
    try {
      await controlCall(token, 'approve-render', { jobId, approverRef: 'owner.browser' });
    } catch (reason) {
      setError(message(reason, 'Approval failed.'));
    } finally {
      setBusy(false);
    }
  }
  async function retry(stage: string) {
    if (!jobId) return;
    setBusy(true);
    try {
      await controlCall(token, 'retry-stage', { jobId, stage });
    } catch (reason) {
      setError(message(reason, 'Retry failed.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card data-testid="live-job-workspace">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">Live product proof</Badge>
          {snapshot && <Badge variant="outline">{snapshot.job.status.replace('_', ' ')}</Badge>}
        </div>
        <CardTitle>Upload once. Keep the hidden target sealed.</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {!jobId ? (
          <UploadInputs
            token={token}
            setToken={setToken}
            files={files}
            setFiles={setFiles}
            busy={busy}
            canStart={canStart}
            onSubmit={start}
          />
        ) : (
          <StageView
            snapshot={snapshot}
            jobId={jobId}
            busy={busy}
            onApprove={approve}
            onRetry={retry}
          />
        )}
        {error && (
          <div
            className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
            role="alert"
          >
            {error}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function message(reason: unknown, fallback: string) {
  return reason instanceof Error ? reason.message : fallback;
}
