#!/usr/bin/env bash
set -euo pipefail

if [ $# -lt 3 ]; then
  echo "usage: setup.sh <task> <dir> <port> [base]" >&2
  exit 2
fi
task=$1 dir=$2 port=$3 base=${4:-phucluu/event-tracker}
branch="phucluu/et-$task"
db="pg_et${task//-/_}"
e2e=$((port + 1))
admin=postgresql://promise_graph:local-development-only@127.0.0.1:55432

case "$task" in *[!a-z0-9-]*) echo "task: use a-z, 0-9 and -" >&2; exit 2 ;; esac
for p in "$port" "$e2e"; do
  case "$p" in 3100 | 3200 | 3310) echo "port $p belongs to the owner" >&2; exit 1 ;; esac
  if lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "port $p is in use" >&2
    exit 1
  fi
done
[ -e "$dir" ] && { echo "$dir exists" >&2; exit 1; }
if docker exec cybernetics-pg psql -U promise_graph -d promise_graph -tAc \
  "select 1 from pg_database where datname = '$db'" | grep -q 1; then
  echo "database $db exists; pick another task name" >&2
  exit 1
fi

checkout_of() {
  git worktree list --porcelain | awk -v b="refs/heads/$1" '/^worktree /{w=$2} $0=="branch " b {print w; exit}'
}
src=
for c in "$(checkout_of "$base")" "$(checkout_of phucluu/event-tracker)" \
  "$(git worktree list --porcelain | awk '/^worktree /{print $2; exit}')"; do
  if [ -n "$c" ] && [ -d "$c/node_modules" ]; then src=$c; break; fi
done
[ -n "$src" ] || { echo "no checkout with node_modules found" >&2; exit 1; }

git worktree add -b "$branch" "$dir" "$base"
if [ "$(uname)" = Darwin ]; then cp -cR "$src/node_modules" "$dir/"; else cp -R "$src/node_modules" "$dir/"; fi

cat >"$dir/.env.local" <<EOF
AUTH_MODE=local
NEXT_PUBLIC_APP_URL=http://localhost:$port
SESSION_SECRET=$(openssl rand -hex 32)
DATABASE_URL=$admin/$db
EOF

docker exec cybernetics-pg createdb -U promise_graph "$db"
(cd "$dir" && node --env-file=.env.local scripts/migrate.mjs)

cat <<EOF
branch    $branch (from $base)
worktree  $dir
database  $db
dev port  $port   start: ./node_modules/.bin/next dev --webpack --hostname localhost --port $port
e2e port  $e2e    gates: .claude/skills/et-gates/run-gates.sh <log dir> $e2e
EOF
