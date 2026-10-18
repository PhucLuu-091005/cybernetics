#!/usr/bin/env bash
set -uo pipefail

if [ $# -lt 2 ]; then
  echo "usage: run-gates.sh <log dir> <e2e port> [--no-e2e]" >&2
  exit 2
fi
log=$1 port=$2 e2e=${3:-}
B=./node_modules/.bin
ADMIN=postgresql://promise_graph:local-development-only@127.0.0.1:55432/promise_graph
[ -x "$B/tsc" ] || { echo "run from the worktree root" >&2; exit 2; }
mkdir -p "$log"

fail=0
gate() {
  local name=$1
  shift
  "$@" >"$log/$name.log" 2>&1
  local rc=$?
  [ $rc -ne 0 ] && fail=1
  printf '%-10s rc=%s\n' "$name" "$rc"
}

gate tsc "$B/tsc" --noEmit
gate eslint "$B/eslint" .
gate prettier "$B/prettier" --check .
gate providers node scripts/check-no-model-dependencies.mjs
gate vitest env TEST_DATABASE_URL=$ADMIN "$B/vitest" run
grep -E '^ +(Test Files|Tests) ' "$log/vitest.log" | sed 's/^ */           /'
grep -q 'skipped' "$log/vitest.log" && echo "           note: vitest skipped some tests; read $log/vitest.log"

if [ "$e2e" = --no-e2e ]; then
  echo "e2e        not run (--no-e2e)"
else
  case "$port" in 3100 | 3200 | 3310) echo "e2e port $port belongs to the owner" >&2; exit 2 ;; esac
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "e2e port $port is in use" >&2
    exit 2
  fi
  gate e2e env TEST_DATABASE_URL=$ADMIN E2E_PORT="$port" "$B/playwright" test
  grep -E '^ +[0-9]+ (passed|failed|flaky|skipped)' "$log/e2e.log" | sed 's/^ */           /'
  gate e2e-demo env TEST_DATABASE_URL=$ADMIN E2E_PORT="$port" "$B/playwright" test -c playwright.demo.config.ts
  grep -E '^ +[0-9]+ (passed|failed|flaky|skipped)' "$log/e2e-demo.log" | sed 's/^ */           /'
fi

if [ $fail -ne 0 ]; then echo "RESULT: FAIL (logs in $log)"; else echo "RESULT: PASS"; fi
exit $fail
