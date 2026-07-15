# Authorized case V2 edit forensics

This report explains what the supplied final edit does relative to the two owner-authorized source
videos. It uses neutral asset IDs and contains no original filenames, local paths, device tags, or
location metadata.

## Executive result

The historical V1 worker did not reconstruct the final edit. It encoded a manually recovered recipe,
omitted its soundtrack and most overlays, and selected the wrong movement phrase from 16.067 to
19.633 seconds.

The corrected source map is:

| Output | Source decision | Layout |
| --- | --- | --- |
| 0.000-6.700 | Source A, frames 464-664 | Full 16:9 frame centered in the 9:16 canvas |
| 6.700-16.067 | Source B, frames 963-1243 | Static centered full-height crop |
| 16.067-19.633 | Source A, frames 942-1048 | Full 16:9 frame centered in the 9:16 canvas |
| 19.633-25.100 | Source B, frames 1355-1518 | Static centered full-height crop |
| 25.100-40.467 | Source A, frames 1212-1672 | Full 16:9 frame centered in the 9:16 canvas |
| 40.467-40.500 | One black frame | Black |
| 40.500-44.500 | Source A frame 1672 frozen and dimmed | Animated social end card |

Every footage passage runs forward at 1.0x. The edit has no speed ramps, reverse playback,
dissolves, optical-flow interpolation, or dynamic reframing.

## How the picture map was recovered

- PySceneDetect independently recovered boundaries at 6.700, 16.067, 19.633, 25.100, and 40.467
  seconds.
- MediaPipe Pose matched root-relative body-motion sequences against both sources.
- OpenCV temporal-motion correlation refined the selected source offsets to 30-fps frame accuracy.
- The disputed window maps to Source A frame 942, not frame 866. V1 was 76 frames, or 2.533
  seconds, early.
- Corrected pose-normalized correlations are about 0.974-0.991. The V1 passage falls mostly around
  0.87-0.89.

The old segment SSIM of 0.923961 was misleading because 68.28% of each fit-layout frame is black.
Content-only SSIM is 0.809175 for the wrong passage versus 0.850237 for the corrected source-only
baseline before matching overlays, color management, and encoding.

## Framing and color

The edit alternates two static spatial treatments:

- Source A is scaled to a 720x406 landscape image and centered at rows 437-842 of the 720x1280
  output.
- Source B is scaled to 2276x1280 and center-cropped to 720x1280.

That alternating wide/full-height contrast creates the apparent visual punch. There is no
subject-tracking crop.

Both sources are 10-bit BT.2020/HLG and carry Dolby Vision side data. The final is 8-bit BT.709 SDR.
Color conversion is therefore a first-class edit decision. V1's Hable transform plus fitted cubic
RGB curve is an approximation, not proof of the editor's exact HDR-to-SDR transform.

## Soundtrack and mix

The final does not retain either phone source's audio.

- 0.0000-40.3386 seconds: a continuous excerpt of
  ["Sign" by 82MAJOR](https://open.spotify.com/track/29WdT0CvbaVoN5pbke3hXX), ISRC
  `KRA382601866`.
- The excerpt begins at approximately 29.146 seconds in the released master, runs at 1.0x, and is
  attenuated by about 6.12 dB.
- 40.3386-40.8373 seconds: intentional silence.
- 40.8373-42.1535 seconds: a separate low-frequency end sting.
- 42.1535-44.5000 seconds: silence/no remaining audio samples.

Independent fingerprint review identifies the released track and records the 29.146-second master
offset as provenance. The final render uses the explicitly target-derived authorized audio asset;
its lag-bounded correlation with the target soundtrack is `0.999504` at `0 ms`. That value is a
target-fidelity check, not an independent released-master measurement. Maximum correlation with
mapped source-audio regions is `0.039134`, below the `0.05` leakage gate.

The dominant beat interval is about 0.569 seconds (approximately 105.5 BPM). Cuts are tastefully
near beats, onsets, and phrase changes, but not naively snapped to the nearest beat. For example,
the disputed visual passage begins about 71 ms before a beat and ends about 94 ms after one, then
anticipates a stronger pickup at 20.097 seconds.

## Timed cue-text track

The target contains 31 cue intervals with hard entrances and exits. The type is a condensed white
sans with a dark outline/shadow, and placement follows the relevant gesture rather than a single
caption box.

| Frames | Cue |
| ---: | --- |
| 0-57 | Sign - solo practice |
| 65-97 | Left / Right |
| 99-126 | Alright |
| 134-156 | Flip flip |
| 170-200 | Jojo mode |
| 203-227 | Head + chest |
| 228-238 | Clack |
| 286-290 | Chin |
| 295-298 | Head |
| 301-332 | Wheel |
| 341-366 | Right now |
| 368-382 | Sharp + clean |
| 438-443 | Clack |
| 460-481 | Relax again |
| 508-511 | Doo |
| 526-529 | Doo |
| 542-546 | Doo |
| 583-588 | Jojo |
| 589-607 | Transition |
| 622-627 | Tick |
| 638-645 | Tick |
| 656-662 | Tock |
| 674-680 | Tick |
| 690-697 | Tick |
| 707-715 | Tick |
| 724-734 | Tock |
| 753-801 | Make up .. up your mind |
| 812-858 | Something something... |
| 873-884 | Clap |
| 892-1213 | Thanks for watching! |
| 1215-1334 | Thanks for watching! over the end card |

V1 recreated only a small subset and started the final message 139 frames too early.

## Global social layer

The social icon/handle is one independent layer whose phase continues across footage cuts. It
alternates between top-right and lower-left about every nine seconds, briefly disappears during
position transitions, and varies icon color between white and a pink/orange gradient. The end card
uses a larger centered variant.

This continuity is evidence that the layer belongs to the global timeline, not to selected source
clips. V1's per-shot static PNGs were structurally wrong.

## Editorial intent inferred from the target

The edit's taste is expressed through coordinated decisions, not any one primitive:

1. Alternate wide and close spatial treatments to create contrast without complex camera motion.
2. Select clean movement phrases from two takes while preserving straight 1.0x choreography.
3. Place cuts near musical events but allow anticipatory offsets when the motion reads better.
4. Add short gesture-specific cue text as rhythmic punctuation.
5. Keep a global social identity layer moving independently of picture cuts.
6. Let the song mute before the visual black frame, then use silence and a separate sting to land
   the end card.

## Proof boundary

This report is reference understanding: the analyzer is allowed to inspect the final. A renderer
must reproduce it from the generated plan and declared assets without importing evaluator-only
answers. An autonomous-editing test is stricter: planner and critic cannot see the final, and music
must come from a user-owned or licensed catalog. Target-derived audio can demonstrate authorized
fidelity, but it cannot prove autonomous music selection.
