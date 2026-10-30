#!/usr/bin/env bash
# Apply repo merge settings and the `main` branch ruleset via the GitHub API.
#
# Usage: scripts/apply-repo-settings.sh [--dry-run] [owner/repo]
#
# - Patches repo settings (auto-merge, delete branch on merge, squash/merge only).
# - Creates or updates the ruleset named `main` from .github/rulesets/main.json.
# - Requires `gh` authenticated with admin rights on the repo.
# - The `Check` and `Lint workflows` status checks should have run at least once
#   (i.e. CI merged) before they are selectable in the UI; the API accepts them regardless.
# - --dry-run prints the planned changes and makes no write calls.
set -euo pipefail

DRY_RUN=0
REPO=""
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -h|--help) sed -n '2,11p' "$0"; exit 0 ;;
    *) REPO="$arg" ;;
  esac
done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RULESET_FILE="$ROOT/.github/rulesets/main.json"
[ -f "$RULESET_FILE" ] || { echo "Missing $RULESET_FILE" >&2; exit 1; }

REPO="${REPO:-$(gh repo view --json nameWithOwner -q .nameWithOwner)}"
echo "Repo: $REPO"
[ "$DRY_RUN" -eq 0 ] || echo "(dry run: no write calls)"

SETTINGS=(
  -F allow_auto_merge=true
  -F delete_branch_on_merge=true
  -F allow_squash_merge=true
  -F allow_merge_commit=true
  -F allow_rebase_merge=false
  -F allow_update_branch=true
  -f squash_merge_commit_title=PR_TITLE
  -f squash_merge_commit_message=PR_BODY
)

echo "Repo settings: ${SETTINGS[*]}"
if [ "$DRY_RUN" -eq 0 ]; then
  gh api -X PATCH "repos/$REPO" "${SETTINGS[@]}" --silent
fi

ID="$(gh api "repos/$REPO/rulesets" --jq '.[] | select(.name=="main") | .id' | head -n1)"
if [ -n "$ID" ]; then
  ACTION="update ruleset main (id $ID)"
else
  ACTION="create ruleset main"
fi
echo "Ruleset: $ACTION from ${RULESET_FILE#"$ROOT"/}"
if [ "$DRY_RUN" -eq 0 ]; then
  if [ -n "$ID" ]; then
    gh api -X PUT "repos/$REPO/rulesets/$ID" --input "$RULESET_FILE" --silent
  else
    gh api -X POST "repos/$REPO/rulesets" --input "$RULESET_FILE" --silent
  fi
fi

echo
if [ "$DRY_RUN" -eq 1 ]; then
  echo "Dry run: no changes made."
else
  echo "Done: settings patched; $ACTION applied."
fi
