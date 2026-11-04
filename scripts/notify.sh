#!/bin/bash
# Sends a Pushover notification (used by the group-workflow when a group is complete).
# Usage: scripts/notify.sh "<title>" "<message>"
# Credentials come from the environment, never from the repository:
#   PUSHOVER_USER_KEY   your Pushover user key
#   PUSHOVER_APP_TOKEN  the API token of a Pushover application you created
#                       (PUSHOVER_APP_KEY is accepted as an alias)
# Without both it does nothing and exits 0, so a missing secret never fails a group. A delivery
# failure is reported (without the credentials) but also exits 0.
set -u

app_token="${PUSHOVER_APP_TOKEN:-${PUSHOVER_APP_KEY:-}}"

title="${1:-Amazing Race}"
message="${2:-Done}"

if [ -z "${PUSHOVER_USER_KEY:-}" ] || [ -z "$app_token" ]; then
  echo "notify: PUSHOVER_USER_KEY or PUSHOVER_APP_TOKEN is not set; skipping" >&2
  exit 0
fi

status=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 \
  --form-string "token=${app_token}" \
  --form-string "user=${PUSHOVER_USER_KEY}" \
  --form-string "title=${title}" \
  --form-string "message=${message}" \
  https://api.pushover.net/1/messages.json 2>/dev/null) || status="curl-failed"

if [ "$status" = "200" ]; then
  echo "notify: sent"
else
  echo "notify: not sent (${status})" >&2
fi
exit 0
