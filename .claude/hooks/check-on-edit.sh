#!/bin/bash
# PostToolUse (Edit|Write|MultiEdit): check the edited file the way CI does, so problems are fixed
# right away instead of surfacing in CI. Remaining problems are fed back to Claude (exit 2).
#
# 1. ESLint (Airbnb + Minecraft rules, formatting) on the edited file, with --fix: formatting and
#    other auto-fixable issues are corrected in place; anything left is reported.
# 2. TypeScript typecheck of the projects, incremental.
#
# Kept fast as the project grows:
# - only the edited file is linted; only files tsc or ESLint cover trigger anything
# - tsc is incremental: it reuses build info and re-checks only changed files and dependents
#   (cache in node_modules/.cache, gitignored and dropped with node_modules)
# - serialised with flock so parallel edits don't race on the cache or on --fix writes
set -uo pipefail

file=$(node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const i=JSON.parse(s).tool_input||{};process.stdout.write(i.file_path||"")}catch{}})')

root="${CLAUDE_PROJECT_DIR:-$PWD}"
rel="${file#"$root"/}"
lint=false typecheck=false
case "$rel" in
  src/*.ts|src/*.mts|src/*.cts|test/*.ts|test/*.mts|test/*.cts) lint=true typecheck=true ;;
  tsconfig*.json) typecheck=true ;;
  scripts/*.mjs|scripts/*.js|*.config.mjs) lint=true ;;
  *) exit 0 ;;
esac

cd "$root" || exit 0
[ -f "$rel" ] || exit 0  # deleted or moved
mkdir -p node_modules/.cache 2>/dev/null || exit 0
exec 9>node_modules/.cache/check-on-edit.lock
flock -w 120 9 || exit 0

status=0
note=""

eslint=node_modules/.bin/eslint
if $lint && [ -x "$eslint" ]; then
  before=$(sha256sum "$rel")
  if ! out=$("$eslint" --fix --max-warnings 0 --no-warn-ignored "$rel" 2>&1); then
    echo "ESLint problems in $rel (auto-fixable ones were already fixed):" >&2
    echo "$out" | head -40 >&2
    status=2
  fi
  if [ "$before" != "$(sha256sum "$rel")" ]; then
    note="ESLint --fix rewrote $rel (formatting/auto-fixes); re-read it before editing it again."
  fi
fi

tsc=node_modules/.bin/tsc
if $typecheck && [ -x "$tsc" ]; then
  projects=(tsconfig.json)
  [ -f tsconfig.test.json ] && projects+=(tsconfig.test.json)
  for p in "${projects[@]}"; do
    info="node_modules/.cache/${p%.json}.tsbuildinfo"
    if ! out=$("$tsc" --noEmit --incremental --tsBuildInfoFile "$info" -p "$p" 2>&1); then
      echo "Typecheck ($p) failed after editing $rel:" >&2
      echo "$out" | head -40 >&2
      status=2
    fi
  done
fi

if [ -n "$note" ]; then
  if [ $status -ne 0 ]; then
    echo "$note" >&2
  else
    # No problems left: tell Claude about the rewrite as context, not as an error.
    NOTE="$note" node -e 'process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:"PostToolUse",additionalContext:process.env.NOTE}}))'
  fi
fi
exit $status
