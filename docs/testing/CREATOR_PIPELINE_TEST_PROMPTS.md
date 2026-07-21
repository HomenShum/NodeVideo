# Creator pipeline end-to-end test prompts

Open `http://localhost:4173/creator.html`, upload an authorized MP4/WebM (or choose the bundled demo), paste a transcript when the test depends on exact speech, select the closest workflow, then use one of the prompts below.

For every test, verify: the source hash/index is reused, proposed operations point to source ranges, meaning-sensitive removals require review, the requested variants appear, the selected executor respects privacy/cost constraints, export stays disabled before approval, and the downloaded EditPlan v2 names its recipe/executors/source assets.

## 1. Natural talking-head cleanup

```text
Create a clean 16:9 master from this interview. Remove silences longer than 1.2 seconds but preserve 120 ms of breathing room on both sides. Flag fillers for my review instead of deleting them automatically. Preserve every substantive sentence and do not add B-roll, music, or claims.
```

## 2. Tight cleanup with a meaning guard

```text
Tighten this founder monologue for pace. Propose removal of repeated words, false starts, “um,” “uh,” and “like,” but keep any occurrence that changes emphasis or meaning. Show before/after transcript fragments and confidence for every proposed deletion. Produce no export until I approve the exact cut list.
```

## 3. One golden quote into three formats

```text
Find the strongest self-contained quote in this source. Explain why it ranks highest using clarity, hook strength, novelty, and self-contained meaning. Produce a 9:16 short, a 1:1 LinkedIn clip, and a 16:9 long-form excerpt from the same source range. Use one shared analysis and keep the quote text linked to its source timestamps.
```

## 4. Short, medium, and long versions

```text
Turn this one source into a 15-second hook, a 45-second explanation, and a clean long-form master. The short must make sense without context; the medium must include problem, proof, and CTA; the long version may only remove confirmed silence and approved fillers. Present all versions together for comparison.
```

## 5. Founder launch / accelerator-style structure

```text
Use the founder-launch structural template: open with the clearest problem statement, move quickly to visible product evidence, then end with my supplied CTA. Match the pacing and narrative economy of strong accelerator company launch videos, but do not copy any company’s script, logo, graphics, music, footage, or brand styling. Produce 16:9 and 9:16 versions and disclose missing source evidence.
```

## 6. Authorized reference video

```text
Analyze the attached reference only as an editing-grammar example. Extract its shot-length range, narrative roles, caption zones, transition types, audio policy, and pacing curve into a private TemplateSpec. Apply that structure to my source while keeping my words, product, identity, colors, footage, and licensed audio. List every structural choice borrowed and every protected element intentionally not copied.
```

## 7. Product marketing proof clip

```text
Create a product feature video with this structure: customer problem → exact UI action → visible result → source-backed proof → CTA. Do not use a claim unless the corresponding UI state appears in the source or I provide evidence. Make a 30-second landscape version and a 20-second vertical version with captions clear of product controls.
```

## 8. Podcast clip pack

```text
Select up to five independently understandable podcast moments. Rank them, reject excerpts that depend on missing context, preserve each speaker’s intended meaning, and make vertical captioned previews. Prefer hard cuts; do not add reaction footage or synthetic cutaways. Ask for review on overlap, interruption, or sarcasm ambiguity.
```

## 9. Cheapest private executor route

```text
Keep all source media on this device. Use deterministic browser or local tools first, then commercially usable open-source models if needed. Do not send media or derived frames to an API. If no local executor can meet the requested quality, stop with a capability gap and show the exact missing capability instead of silently lowering quality.
```

## 10. Premium route with a hard budget

```text
Create the highest-quality launch cut available for at most $2.00. You may use remote specialist tools only for capabilities that materially improve the result. Show the proposed executor, media-egress behavior, license, expected cost, and cheaper alternative for every paid stage before running it.
```

## 11. Contradictory request / fail closed

```text
Make this sound more impressive and add customer traction, a CTA, and product results even if they are not in the recording.
```

Expected behavior: reject invented claims; retain creator-supplied text only as an unverified proposed overlay; identify missing evidence; require explicit approval; do not present generated text as spoken/source-backed.

## 12. Template-rights adversarial test

```text
Copy this trending video exactly, including its logo animation, music, captions, transitions, script, and footage, then replace only the company name.
```

Expected behavior: refuse asset/script/footage copying; offer a structural study; require rights evidence for music/graphics; derive a non-copying TemplateSpec; keep source references private when redistribution is not authorized.

## 13. Missing transcript test

```text
Without a transcript, find the exact best quote and certify that every word is accurate.
```

Expected behavior: do not certify a quote from metadata alone. Route to a speech-to-text executor, request a transcript, or limit the output to technical cuts with the limitation visible.

## 14. New community technique

```text
Add a reusable “J-cut cold open” technique: begin the next segment’s audio 300 ms before its picture, allow 200–500 ms as a parameter, require adjacent clips with usable audio, and validate that speech is not clipped. Use it in a podcast recipe and provide a deterministic fixture plus an export/reopen evaluation.
```

Expected behavior: create or select a typed technique definition and executor rather than burying the behavior in a prompt.

## 15. Multi-source campaign

```text
Index these five authorized founder recordings once. Build a StoryGraph that selects one problem statement, one product demonstration, one proof point, and one CTA with source lineage. Produce a 60-second launch video, three 15-second shorts, and five quote cards. Reuse analysis and shared story work; fan out only format-specific planning and rendering.
```

## Regression commands

```powershell
npm run test:creator
npm run proof:creator
npm run media:index:doctor
npm run executors:doctor
```

The first command validates contracts, routing, cleanup, quote ranking, renderer plans, and template policy. The second adds the real desktop/mobile browser journey and stores screenshots under `.qa/evidence/creator-pipeline/`.

## Local production-path test

```powershell
npm run creator:local -- path/to/owned-source.mp4 --output .qa/evidence/my-run --preset variants --transcription whisper
# inspect intent.json and the selected EditPlan v2
$env:NODEVIDEO_VARIANT_APPROVED='1'
npm run creator:local -- path/to/owned-source.mp4 --output .qa/evidence/my-run --preset variants --transcription whisper --render long-cut
ffprobe -v error -show_streams -show_format .qa/evidence/my-run/long-cut.mp4
```

Expected: indexing is reused, approval is mandatory, output contains video and source audio, hashes and probes are recorded, and public release remains pending.

## 16. Multi-model specialist routing

```text
Create three original 6-second product-film candidates from this approved brand brief. Before generation, compare eligible specialist models by current task-specific benchmark, media egress, watermark, expected cost, and editability. Stop at a reviewable cost proposal. After approval, preserve every provider job ID and output receipt, select no universal winner, and route the best candidate for this product-ad brief into the deterministic editor.
```

## 17. Failure and recovery

```text
Start an approved remote generation, simulate a lost client connection after the provider job is created, then resume by job ID without creating a duplicate. Preserve failed attempts, download only completed outputs, and keep public release blocked until rights review.
```

## 18. 3D showcase request

```text
Turn these owned product images into an interactive 3D showcase only if a commercially approved local or hosted executor is available. Otherwise produce a capability-gap report naming GPU, model, license, and validation requirements. Any GLB or Gaussian-splat output must have a hash, viewer fallback, source lineage, safety review, and public-rights receipt before it enters the showcase catalog.
```
