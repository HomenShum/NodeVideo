# Blind taste and music handoff

NodeVideo separates three claims that are easy to blur together:

1. **Blind generation:** a planner creates and freezes an edit without access to the held-out target.
2. **Technical similarity:** after the freeze, an evaluator may compare timing, source selection, and
   audiovisual structure with the held-out target.
3. **Creative taste:** blinded people prefer the agent edit to a preregistered baseline.

The first public pilot can prove claim 1 for one case and report claim 2 as diagnostic evidence. It
cannot establish generalized taste by self-scoring or by matching one target. Claim 3 needs repeated
held-out cases and blinded preference data.

## Generation boundary

The planner receives only sanitized source proxies, a creator brief, generic tools, and optional
public music-catalog metadata. It runs in a fresh context and is instructed not to read the parent
repository. Target video, target audio, target-derived LUTs, ground truth, prior plans, and prior
analysis are absent from its input directory and forbidden.

Before any evaluator sees the target, the run freezes:

- input hashes;
- exact source trims, framing, text, and source-audio policy;
- the clean preview hash;
- music candidates plus preview-reference and desired-alignment guidance;
- a read log and a hash receipt for every deliverable.

The public manifest binds the freeze, preview, plan, music handoff, read log, rationale, and
post-freeze evaluation with SHA-256. A missing or changed byte blocks the UI claim.

This is an audited context-isolation protocol, not a cryptographic sandbox. A stronger production
version should run the planner in a separate job whose read-only mount contains only declared
inputs, deny parent-volume access, and sign the freeze receipt before mounting the held-out target
in a separate evaluator job.

## Music without redistributing commercial audio

NodeVideo's music output is an instruction artifact, not a music file. It contains:

- track title and artist;
- a copyable Instagram search query;
- exact full-track timestamps when verified, otherwise an audible cue such as “first chorus
  downbeat”;
- video-time to verified-reference anchors, labeled as desired alignments for each meaningful cut,
  lift, or drop;
- a clean export with no commercial soundtrack bytes; and
- a short in-app handoff telling the creator how to add and align the track in Instagram.

The creator must confirm that the track is available to their own account and region. NodeVideo does
not claim that an Instagram link preselects a licensed segment, does not automate rights clearance,
and does not promise that a library track remains available. If licensed music is unavailable, the
handoff should recommend a Meta Sound Collection or creator-licensed alternative with the same
tempo and energy structure.

## Taste benchmark preregistration

A credible first benchmark should contain at least 20 owner-authorized held-out cases. For each case:

1. Freeze one source-only agent edit and one deterministic chronological baseline.
2. Randomize A/B labels and hide provenance from raters until after their choice.
3. Ask for overall preference plus separate pacing, story clarity, text restraint, and music-fit
   judgments.
4. Keep the primary endpoint as pairwise preference against the baseline.
5. Claim a positive taste result only when the agent wins more than 60% and the lower bound of a 95%
   Wilson confidence interval exceeds 50%.

Target-similarity metrics, model critics, and creator comments remain secondary diagnostics. They may
explain a win or failure, but they cannot substitute for blinded human preference evidence.
