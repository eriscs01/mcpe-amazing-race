#!/bin/bash
# SessionStart: install everything needed to typecheck, test and package the add-on.
set -euo pipefail

# Cloud sessions only; local machines manage their own setup.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}"

# `npm run package` needs the system zip.
if ! command -v zip >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then
    (apt-get update -qq && apt-get install -y -qq zip) >/dev/null
  else
    echo "session-start: zip not found and apt-get unavailable; npm run package will fail" >&2
  fi
fi

# Run npm install only if a listed file has changed since it last succeeded.
hashes=node_modules/.session-start.sha256
if ! sha256sum --check --status "$hashes" 2>/dev/null; then
  rm -f "$hashes"
  npm install --no-audit --no-fund
  sha256sum .claude/hooks/session-start.sh package.json package-lock.json > "$hashes"
fi
