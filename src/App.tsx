import { Badge } from '@/components/ui/badge';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { AppHeader } from '@/features/nodevideo/app-header';
import { EntryHero } from '@/features/nodevideo/entry-hero';
import { InspectorPanel } from '@/features/nodevideo/inspector-panel';
import type { MobileView } from '@/features/nodevideo/model';
import { ProjectPanel } from '@/features/nodevideo/project-panel';
import { useNodeVideoWorkspace } from '@/features/nodevideo/use-nodevideo-workspace';
import { Workbench } from '@/features/nodevideo/workbench';
import { cn } from '@/lib/utils';
import { Activity, CircleDot, Eye, Film, Layers } from 'lucide-react';

export function App() {
  const { state, actions } = useNodeVideoWorkspace();
  const status = state.isRunning
    ? 'running'
    : state.runComplete
      ? 'recorded'
      : state.mode !== 'empty'
        ? 'ready'
        : 'empty';
  const paneClass = 'min-h-0 min-w-0 flex-col overflow-hidden border-border bg-background xl:flex';
  const activePane = (pane: MobileView) => (state.mobileView === pane ? 'flex' : 'hidden');

  return (
    <div
      className="flex h-svh flex-col overflow-hidden bg-background text-foreground"
      data-testid="app-shell"
    >
      <AppHeader
        mode={state.mode}
        checkpoint={state.checkpoint}
        onDownloadReceipt={actions.downloadReceipt}
      />
      <main
        className={cn(
          'min-h-0 flex-1 overflow-x-hidden',
          state.mode === 'empty'
            ? 'flex overflow-y-auto'
            : 'grid grid-cols-1 overflow-hidden xl:grid-cols-12',
        )}
      >
        {state.mode !== 'empty' ? (
          <aside
            className={cn(paneClass, 'border-r xl:col-span-3', activePane('project'))}
            aria-label="Project sources and pipeline"
          >
            <PaneHeader title="Project">
              <Badge variant="outline">
                <span
                  className={cn(
                    'size-1.5 rounded-full bg-muted-foreground',
                    state.isRunning && 'animate-pulse bg-amber-400',
                    state.runComplete && 'bg-primary',
                    status === 'ready' && 'bg-cyan-400',
                  )}
                />
                {status}
              </Badge>
            </PaneHeader>
            <ProjectPanel
              mode={state.mode}
              checkpoint={state.checkpoint}
              localMedia={state.localMedia}
              displayStages={state.displayStages}
              runComplete={state.runComplete}
              onFiles={actions.selectFiles}
              onLoadDemo={actions.loadDemo}
              onDownloadManifest={actions.downloadManifest}
            />
          </aside>
        ) : null}

        <section
          className={cn(
            'min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-muted/10',
            state.mode === 'empty' ? 'flex' : activePane('canvas'),
            state.mode !== 'empty' && 'xl:col-span-6 xl:flex',
          )}
          aria-label="Video workbench"
        >
          {state.mode === 'empty' ? (
            <EntryHero onLoadDemo={actions.loadDemo} onFiles={actions.selectFiles} />
          ) : (
            <Workbench
              mode={state.mode}
              localMedia={state.localMedia}
              compareView={state.compareView}
              onCompareView={actions.setCompareView}
              runComplete={state.runComplete}
              isRunning={state.isRunning}
              onRun={actions.run}
            />
          )}
        </section>

        {state.mode !== 'empty' ? (
          <aside
            className={cn(paneClass, 'border-l xl:col-span-3', activePane('inspect'))}
            aria-label="Evidence inspector"
          >
            <PaneHeader title="Evidence">
              <Badge variant="outline">
                <Eye aria-hidden="true" /> inspectable
              </Badge>
            </PaneHeader>
            {state.checkpoint?.stages.length ? (
              <InspectorPanel
                checkpoint={state.checkpoint}
                proposal={state.proposal}
                decision={state.decision}
                onAccept={actions.accept}
                onDecline={actions.decline}
                onRestore={actions.restore}
              />
            ) : (
              <div className="flex flex-1 items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
                <CircleDot className="size-4 shrink-0" aria-hidden="true" />
                <span>
                  {state.mode === 'local'
                    ? 'Local previews do not claim analysis evidence.'
                    : 'Run the proof to record artifacts and traces.'}
                </span>
              </div>
            )}
          </aside>
        ) : null}
      </main>

      {state.mode !== 'empty' ? (
        <ToggleGroup
          type="single"
          value={state.mobileView}
          onValueChange={(value) => value && actions.setMobileView(value as MobileView)}
          className="grid h-16 w-full shrink-0 grid-cols-3 gap-1 rounded-none border-t bg-background p-1 xl:hidden"
          aria-label="Workspace views"
        >
          <ToggleGroupItem value="project" className="h-full flex-col gap-1">
            <Layers aria-hidden="true" /> Project
          </ToggleGroupItem>
          <ToggleGroupItem value="canvas" className="h-full flex-col gap-1">
            <Film aria-hidden="true" /> Canvas
          </ToggleGroupItem>
          <ToggleGroupItem value="inspect" className="h-full flex-col gap-1">
            <Activity aria-hidden="true" /> Inspect
          </ToggleGroupItem>
        </ToggleGroup>
      ) : null}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {state.announcement}
      </div>
    </div>
  );
}

function PaneHeader({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b px-3">
      <h2 className="font-heading text-sm font-semibold">{title}</h2>
      {children}
    </div>
  );
}
