import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AspectRatio } from '@/components/ui/aspect-ratio';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item';
import { usePublishedBlindPilot } from '@/lib/published-blind-pilot';
import { usePublishedSongReplay } from '@/lib/published-song-conditioned';
import {
  Captions,
  ChevronDown,
  FileJson2,
  Film,
  GitCompareArrows,
  ListMusic,
  Music2,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { useState } from 'react';
import { BlindPilotEvidence } from './blind-pilot-evidence';

const inputs = [
  {
    description: 'The intended movement sequence and timing, separate from the creator takes.',
    icon: GitCompareArrows,
    title: 'Original choreography reference',
  },
  {
    description: 'One or more recordings to align, score by phrase, and cut between.',
    icon: Film,
    title: 'Creator takes',
  },
  {
    description: 'A user-selected track and exact segment provide beats, accents, and phrasing.',
    icon: Music2,
    title: 'Chosen song + segment',
  },
  {
    description: 'Lyrics become timed, body-safe overlays instead of fixed screen coordinates.',
    icon: Captions,
    title: 'Lyrics + text cues',
  },
] as const;

const artifacts = [
  ['Interpretation', 'understanding.json'],
  ['Frozen edit plan', 'edit-plan.json'],
  ['Freeze receipt', 'freeze-receipt.json'],
  ['Post-freeze evaluation', 'evaluator-report.json'],
  ['Replay manifest', 'manifest.json'],
] as const;

const baseUrl = '/media/song-conditioned-auto-edit-v1';

export function SongConditionedPanel() {
  const [blindOpen, setBlindOpen] = useState(false);
  const blind = usePublishedBlindPilot(blindOpen);
  const replay = usePublishedSongReplay();

  return (
    <Card data-testid="song-conditioned-panel">
      <CardHeader>
        <Badge className="w-fit">
          <Sparkles aria-hidden="true" /> Public deterministic replay
        </Badge>
        <CardTitle>Song-conditioned choreography edit</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert data-testid="case-input-boundary">
          <ShieldCheck aria-hidden="true" />
          <AlertTitle>
            {replay.status === 'verified'
              ? 'Replay SHA-256 verified; supplied-case inputs remain incomplete'
              : replay.status === 'blocked'
                ? 'Replay blocked'
                : 'Verifying replay artifacts'}
          </AlertTitle>
          <AlertDescription>
            {replay.error ??
              'This public replay proves the mechanics with an original 120 BPM fixture. The supplied real case has two takes, but no independent choreography reference or separately supplied song master. Source A is a creator-selected fallback until those inputs are provided.'}
          </AlertDescription>
        </Alert>

        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
          <section className="space-y-3" aria-labelledby="workflow-inputs-title">
            <h3 className="font-heading font-medium" id="workflow-inputs-title">
              Required inputs
            </h3>
            <ItemGroup className="gap-2">
              {inputs.map(({ description, icon: Icon, title }) => (
                <Item asChild key={title} variant="outline">
                  <li>
                    <ItemMedia variant="icon">
                      <Icon aria-hidden="true" />
                    </ItemMedia>
                    <ItemContent className="min-w-0">
                      <ItemTitle className="line-clamp-none">{title}</ItemTitle>
                      <ItemDescription className="line-clamp-none">{description}</ItemDescription>
                    </ItemContent>
                  </li>
                </Item>
              ))}
            </ItemGroup>
            <div className="flex flex-wrap gap-2" aria-label="Replay guarantees">
              <Badge variant="secondary">Grounding: replay</Badge>
              <Badge variant="outline">Manual boxes supported</Badge>
              <Badge variant="outline">LocateAnything optional</Badge>
              <Badge variant="secondary">Source-camera audio muted</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              The planner aligns movement to song phrases, chooses a take per phrase, places text
              away from the body, and freezes a typed plan. The CLI accepts no target; its audited
              allowlist is not an OS sandbox.
            </p>
          </section>

          <section className="space-y-3 rounded-lg border p-3" aria-labelledby="replay-title">
            <div>
              <h3 className="font-heading font-medium" id="replay-title">
                Generated replay
              </h3>
              <p className="text-sm text-muted-foreground">
                A/B/A phrase cuts, synthetic music, and body-safe lyric cues.
              </p>
            </div>
            <AspectRatio
              className="mx-auto max-w-64 overflow-hidden rounded-lg bg-black"
              ratio={9 / 16}
            >
              {/* biome-ignore lint/a11y/useMediaCaption: The fixture has music and visual lyric cues but no spoken dialogue. */}
              <video
                aria-label="Song-conditioned deterministic replay"
                className="size-full object-contain"
                controls
                playsInline
                preload="metadata"
                src={replay.status === 'verified' ? `${baseUrl}/preview.mp4` : undefined}
              />
            </AspectRatio>
            <div className="flex flex-wrap gap-2" data-testid="song-conditioned-artifacts">
              {replay.status === 'verified'
                ? artifacts.map(([label, file]) => (
                    <Button asChild key={file} size="sm" variant="outline">
                      <a href={`${baseUrl}/${file}`}>
                        <FileJson2 aria-hidden="true" /> {label}
                      </a>
                    </Button>
                  ))
                : null}
            </div>
          </section>
        </div>

        <Collapsible onOpenChange={setBlindOpen} open={blindOpen}>
          <CollapsibleTrigger asChild>
            <Button
              className="w-full justify-between"
              variant="outline"
              data-testid="blind-pilot-trigger"
            >
              Prior blind source-only pilot
              <ChevronDown className={blindOpen ? 'rotate-180' : ''} aria-hidden="true" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <section
              className="mt-3 space-y-2 rounded-lg border p-3"
              data-testid="blind-pilot-panel"
            >
              <p className="text-sm text-muted-foreground" data-testid="blind-pilot-integrity">
                {blind.loaded
                  ? `${blind.loaded.integrity.verifiedAssetCount} public proof assets plus the trusted manifest are SHA-256 verified.`
                  : (blind.error ?? 'Verifying the prior frozen source-only run…')}
              </p>
              {blind.loaded ? (
                <p className="text-sm" data-testid="blind-taste-boundary">
                  Blind protocol proven; generalized taste is not claimed by this single pilot.
                </p>
              ) : null}
              {blind.loaded ? <BlindPilotEvidence manifest={blind.loaded.manifest} /> : null}
            </section>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}
