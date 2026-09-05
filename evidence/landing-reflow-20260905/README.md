# Landing reflow evidence

A visitor can enlarge the landing page's text and still read its actions, counts and pose provenance. The caption now has its own space below the canvas. This packet supports that local layout repair; complete application grades remain unassigned.

Run the standard-library byte check from the repository root:

```powershell
python evidence/landing-reflow-20260905/verify.py
```

The verifier checks retained payload bytes and the copy map. It does not rerun the app or upgrade historical outcomes. Normal application verification remains `npm run check`; the existing nine-case clock regression is in its 353-test suite.

## Compare the actual page

- [Desktop before](raw/E6i-nodevideo-landing-reflow-before-pixels/1440-normal-full.png) and [after](raw/E6i-nodevideo-landing-reflow-after-pixels/1440-normal-full.png). The caption adds height to the outer card and slightly shifts desktop vertical centering.
- [Enlarged 320px before](raw/E6i-nodevideo-landing-reflow-before-pixels/320-text200-full.png) and [after](raw/E6i-nodevideo-landing-reflow-after-pixels/320-text200-full.png).
- [Enlarged 390px before](raw/E6i-nodevideo-landing-reflow-before-pixels/390-text200-full.png) and [after](raw/E6i-nodevideo-landing-reflow-after-pixels/390-text200-full.png).
- [Full caption below the canvas](raw/E6i-nodevideo-landing-reflow-after-pixels/320-text200-caption.png).
- [Actual layout diff](raw/E6i-nodevideo-landing-reflow-freeze-01/owner.diff.txt.txt) and [source-bound proof](raw/E6i_NODEVIDEO_LANDING_REFLOW_FREEZE.json.txt).

The retained before and after sets each cover 320×800, 360×800, 390×844, 768×1024, 1024×768, 1440×960 and 1920×1080. Additional conditions double every initial computed font size, including HTML, at 320/390/1440; reduced-motion cells also cover 390/1440. Computed-font doubling is not native browser or operating-system zoom.

The original enlarged page overflows by 201px at 320 and 131px at 390. All twelve after conditions have zero horizontal document overflow, no text rectangles outside the viewport, and the full caption below the square canvas. All visible text, ten link labels/destinations, eight count cells and intrinsic 560×560 canvas size remain exact. Two native keyboard journeys, at 390 and 1440, traverse the ten links and use Enter to open the actual local Studio and agent contract.

The ordinary after check passed in 65.687 seconds: 353 tests / 74 files, lint, types, existing capability/fixture gates, build and rendered contract. This is local evidence at parent 30593fde plus the one bound landing owner. It does not claim shared CI or public deployment for this layout.

## Failures and evidence limits

The first launcher failed before any browser because cmd passed literal quotes in the Node path; its failure and original controller remain. The next baseline completed twelve cells and two keyboard journeys with no raw errors. Independent review then found that recorded browser errors could leave a zero process exit and that entry build files were not explicitly bound. Both are corrected in the after recorder/controller: errors or incomplete work fail, the entry build must match the preceding check, and every build file must remain exact afterward. The historical missing baseline entry manifest is not recreated; its preceding-build and final-observation manifests match.

All raw non-image records, full-page images, caption images, keyboard-focus images and Studio destination images from this bounded proof are included. Overlapping scroll-segment and canvas-only images remain operator-local and are enumerated with exact hashes in [the copy map](copy-map.json.txt). Historical scripts, HTML and records are inert `.txt` copies; embedded operator paths and links describe their original run and are not portable replay commands. Earlier exploratory CSS probes remain separately recorded by the central recovery packet; this publication uses its own freshly built baseline and actual source repair.

Camera/provider execution, other editor panels, full-duration video export, physical devices, native zoom, field performance, human preference and complete visual/accessibility grades remain outside this repair. Existing missing-landmark frames still cause brief blank poses. Historical 44-criterion ratings remain unchanged.

Independent [final source judgment](raw/E6i_NODEVIDEO_LANDING_REFLOW_FINAL_JUDGE.md.txt) verifies 70 checks and the actual pixels. R1 content preservation and the landing parts of R3, A4 and V5 improve in this measured scope; R2 keyboard reachability is observed. Full criterion and dimension grades remain unassigned.
