#!/usr/bin/env sh
# End-to-end contract check of every endpoint against a running API (`make run` in another shell).
# Resets the demo state before and after.
set -eu
cd "$(dirname "$0")/.."
E2E_BASE_URL="${E2E_BASE_URL:-http://localhost:8080}" go test -count=1 -v ./e2e/ | grep -E '^(--- |    --- |ok|FAIL|PASS)'
