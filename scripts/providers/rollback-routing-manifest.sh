#!/usr/bin/env bash
# Automatic rollback for config/openrouter-free-routing.json.
#
# Called by .github/workflows/openrouter-free-models.yml when the
# canary/benchmark step fails. Restores the manifest as it was before the
# last commit that touched it and commits the revert. The caller pushes.
#
# Guards (each exits 0 without committing, so the workflow can tell "rolled
# back" from "nothing to roll back" by comparing HEAD before/after):
#  - discard any uncommitted manifest edits left by the failed benchmark run
#  - refuse when no commit touches the manifest
#  - refuse when the last manifest commit is itself a rollback (no ping-pong:
#    reverting a revert would reinstate the exact routing the canary rejected)
#  - refuse when the manifest has no prior version to restore
#  - refuse when the restore produces no diff
set -euo pipefail

MANIFEST='config/openrouter-free-routing.json'
MARKER='revert: roll back OpenRouter free-model routing after canary failure'

# A failed benchmark may have rewritten the manifest in the working tree
# before dying; rollback reasons about committed history only.
git checkout -- "$MANIFEST" 2>/dev/null || true

last=$(git log -n 1 --format=%H -- "$MANIFEST")
if [[ -z "$last" ]]; then
  echo "no commit touches $MANIFEST; nothing to roll back"
  exit 0
fi

last_subject=$(git log -n 1 --format=%s "$last")
if [[ "$last_subject" == "$MARKER" ]]; then
  echo "last manifest change ($last) is already a rollback; refusing to ping-pong"
  exit 0
fi

if ! git rev-parse -q --verify "$last^:$MANIFEST" >/dev/null; then
  echo "no manifest version exists before $last; nothing to roll back to"
  exit 0
fi

git checkout "$last^" -- "$MANIFEST"
if git diff --quiet --cached -- "$MANIFEST" && git diff --quiet -- "$MANIFEST"; then
  echo "manifest already matches the version before $last; nothing to commit"
  exit 0
fi

git add "$MANIFEST"
git commit -m "$MARKER" \
  -m "Reverts the manifest change from $last because the scheduled canary/benchmark step failed. Evidence: the failing run's openrouter-free-model-benchmark artifact."
echo "reverted manifest change from $last"
