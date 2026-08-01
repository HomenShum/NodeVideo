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

## 19. Group-performance reframing

```text
Track the selected three-person formation through crossings and temporary occlusion. Make a 9:16
version, but widen or use an honest blurred-fit fallback whenever a crop would cut a member. Show
identity warnings, action-envelope coverage, crop motion, and the exact proposal before export.
```

## 20. Object/product target seed

```text
Use my first-frame selection as the product target, then follow it locally with the cheapest
reliable tracker. Preserve the hands-and-object interaction envelope, hold through low confidence,
and compare the automatic detector with the explicit-seed route. Do not claim automatic discovery
if the selected route required my seed.
```

## 21. Animal tracking

```text
Follow the selected dog across the frame and create vertical and square versions. Keep the whole
animal visible, widen when the detector loses it behind another dog, and never silently switch
identity. Return the low-confidence ranges and target-coverage critic with the proposed crop path.
```

## 22. Climbing policy

```text
Create a vertical climbing highlight that follows the climber while preserving lead room along the
movement corridor. When the climber is too small for reliable pose landmarks, use the object/person
detector and a conservative hold. Mark that limitation in the receipt.
```

## 23. Workout group policy

```text
Keep both athletes and the active equipment visible during each repetition. Generate a stable 9:16
coach version and a responsive highlight version from one analysis. Show which frames used pose,
generic person detection, or a wide group fallback.
```

## 24. Board-sport action envelope

```text
Track the rider and skateboard as one action envelope, add predictive lead room before takeoff and
landing, and produce three edit directions: stable tutorial, responsive highlight, and cinematic
slow-motion. Keep every crop keyframe editable and reviewable.
```

## 25. Ball-sport semantics

```text
For basketball or soccer, follow the ball plus the nearest active-player and goal/hoop context.
Compare the cheap automatic detector with an explicit first-frame target seed. Do not center a
single player when the play moves elsewhere, and do not call the seeded route automatic.
```

## 26. Artifact Atlas audit

```text
Open the NodeVideo Artifact Atlas. For every group, object, animal, and sport fixture, inspect the
before image, after image, comparison video, detector route, target coverage, source license, source
hash, limitations, and output hashes. Then compare Harness v0 with v1 and identify the next pack
that should be promoted only after held-out creator proof.
```

## 27. Smart Reframe — full-body performance

```text
Track the primary performer locally and make 9:16, 1:1, and 16:9 versions from one shared subject track. Keep the full body and movement envelope visible, use smooth camera motion, hold the last trustworthy crop during occlusion, and show the crop path before approval. Do not upload frames.
```

Expected: local pose tracking, explicit subject selection, one cached `SubjectTrack`, three typed `ReframePlan` artifacts, critic coverage, crop-path timeline, and local preview/export geometry from the same keyframes.

## 28. Smart Reframe — speaker composition

```text
Create a 9:16 speaker crop. Keep the selected speaker near the left third with useful look room, avoid cutting hands when gestures enter frame, use the stable motion preset, and flag every low-confidence range for review.
```

## 29. Smart Reframe — manual correction precedence

```text
Generate the vertical crop path, then let me drag the crop at the first incorrect moment. Preserve my manual keyframe exactly, re-run the critic, and compile a fresh proposal without changing the original source.
```

Expected: the manual keyframe appears as a locked marker and wins over regenerated coordinates at that frame.

## 30. Smart Reframe — identity-switch adversarial test

```text
Two people cross paths. Follow only the person I select. If identity confidence becomes weak, hold or widen instead of switching to the other person. Report identity continuity and any unresolved ranges.
```

## 31. Smart Reframe — no stable subject

```text
Make a vertical subject-following cut even if no person can be detected reliably.
```

Expected: fail closed with `no-subject`, retain the uncropped source, and offer manual framing rather than inventing a track.

## 32. Smart Reframe — privacy boundary

```text
Use the cheapest available reframe executor, but do not send raw media or derived frames off this device. If the local tracker cannot meet the request, stop with the exact capability gap.
```

Expected: MediaPipe and deterministic planning remain local; a remote specialist is not silently substituted.
