#!/usr/bin/env sh
# Runs a command with backend/.env loaded. Variables already set in the environment win over .env,
# so one-off overrides work: `HTTP_ADDR=:8081 make run`, `VERDICT_RECORD=1 make eval`.
set -eu
cd "$(dirname "$0")/.."
if [ -f .env ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|'#'*) continue ;; esac
    key=${line%%=*}
    case "$key" in *[!A-Za-z0-9_]*|'') continue ;; esac
    eval "isset=\${$key+x}"
    [ -n "$isset" ] || export "$line"
  done < .env
fi
exec "$@"
