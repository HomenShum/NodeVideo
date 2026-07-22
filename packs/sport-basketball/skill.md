# Basketball

Use this pack when the requested target semantics match **sports ball, hoop, person**.

## Contract

1. Verify source authorization.
2. Detect with yolo11n-coco -> bytetrack -> court-landmarks-optional.
3. Emit the common DetectionTrack and ActionEnvelope artifacts.
4. Apply the ball-action framing policy.
5. Validate target coverage, crop motion, identity switches, and preview/export parity.
6. Return a reviewable proposal; never mutate the canonical video directly.

## Honest boundary

The checked-in fixture is rights-cleared stock evidence, not proof of universal creator-media performance. Low-confidence ranges hold or widen; they never silently switch targets.
