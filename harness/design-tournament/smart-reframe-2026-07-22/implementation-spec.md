# Binding contract

- Subject chips → `SubjectTrack.id`, `identityContinuity`, first observation box.
- Aspect selector → `FramingIntent.aspectRatio`.
- Policy and motion selectors → deterministic preset parameters.
- Crop overlay → accepted `EditPlan.cropKeyframes`, never prose coordinates.
- Warning lane → `trackingLossRanges` and critic findings.
- Manual controls → `ReframePlan.manualOverrides`; same-frame generated keyframe is replaced.
- Proposal → digest-bound NodeKit Caseflow snapshot.
- Preview/export → the same renderer plan.
- Run Inspector → track ID, observation count, identity continuity, confidence loss ranges, critic,
  crop-keyframe count, manual override count, and local-egress statement.

Honest states: idle, analyzing locally, subjects found, no subject found, plan ready, review/fail,
approved, and export failed. No remote processing label may appear without a separate approval.

