#!/bin/bash
# PostToolUse (Edit|Write|MultiEdit): typecheck after a TypeScript/JavaScript file is edited.
# Errors are fed back to Claude (exit 2) so they get fixed right away.
set -uo pipefail

file=$(node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const i=JSON.parse(s).tool_input||{};process.stdout.write(i.file_path||"")}catch{}})')

case "$file" in
  *.ts|*.mts|*.cts|*.js|*.mjs|*.cjs|*/tsconfig*.json) ;;
  *) exit 0 ;;
esac

cd "${CLAUDE_PROJECT_DIR:-.}"
[ -x node_modules/.bin/tsc ] || exit 0  # dependencies not installed yet

if ! out=$(node_modules/.bin/tsc --noEmit -p . 2>&1); then
  echo "Typecheck failed after editing $file:" >&2
  echo "$out" | head -40 >&2
  exit 2
fi
exit 0
