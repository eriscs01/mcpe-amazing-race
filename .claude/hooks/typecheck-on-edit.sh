#!/bin/bash
# PostToolUse (Edit|Write|MultiEdit): typecheck after a file the TypeScript project covers is edited.
# Errors are fed back to Claude (exit 2) so they get fixed right away.
#
# Kept fast as the project grows:
# - only runs for files tsc actually checks (src/, test/, tsconfig*.json); docs, scripts, etc. skip
# - incremental: tsc reuses its build info and re-checks only changed files and their dependents
#   (cache lives in node_modules/.cache, gitignored and dropped with node_modules)
# - serialised with flock so parallel edits don't race on the cache
set -uo pipefail

file=$(node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const i=JSON.parse(s).tool_input||{};process.stdout.write(i.file_path||"")}catch{}})')

root="${CLAUDE_PROJECT_DIR:-$PWD}"
rel="${file#"$root"/}"
case "$rel" in
  src/*.ts|src/*.mts|src/*.cts|test/*.ts|test/*.mts|test/*.cts|tsconfig*.json) ;;
  *) exit 0 ;;
esac

cd "$root"
tsc=node_modules/.bin/tsc
[ -x "$tsc" ] || exit 0  # dependencies not installed yet

mkdir -p node_modules/.cache
exec 9>node_modules/.cache/typecheck.lock
flock -w 120 9 || exit 0

projects=(tsconfig.json)
[ -f tsconfig.test.json ] && projects+=(tsconfig.test.json)

status=0
for p in "${projects[@]}"; do
  info="node_modules/.cache/${p%.json}.tsbuildinfo"
  if ! out=$("$tsc" --noEmit --incremental --tsBuildInfoFile "$info" -p "$p" 2>&1); then
    echo "Typecheck ($p) failed after editing $rel:" >&2
    echo "$out" | head -40 >&2
    status=2
  fi
done
exit $status
