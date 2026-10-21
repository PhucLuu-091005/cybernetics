#!/usr/bin/env bash
# usage: env.sh up <dir> <port> [ref]           detached worktree + own database + own dev server; QA_AUTH_MODE=demo for demo mode
#        env.sh driver <dir> <port> <dport> [base] exploratory browser driver on <dport>; base: another app, such as the live one
#        env.sh gates <dir> <port> <log file>    every gate in <dir>-gates on <port>+1, then removes it
#        env.sh down <dir> <port>                stop, remove and drop all of the above, then verify
#        env.sh status <dir> <port>              print what is left; exit 1 if anything is
set -euo pipefail

cmd=${1:-} dir=${2:-} port=${3:-}
[ -n "$cmd" ] && [ -n "$dir" ] && [ -n "$port" ] || {
  echo "usage: env.sh up|driver|gates|down|status <dir> <port> [...]" >&2
  exit 2
}
here=$(cd "$(dirname "$0")" && pwd)
db="pg_qa_$port"
admin=postgresql://promise_graph:local-development-only@127.0.0.1:55432
gates="$dir-gates"
# State lives next to the worktree, not in it, so it survives the worktree removal.
state="$dir.qa-state"

case "$port" in 3100 | 3200 | 3310) echo "port $port belongs to the owner" >&2; exit 1 ;; esac

remember() { echo "$1=$2" >>"$state"; }
recall() { [ -f "$state" ] && grep "^$1=" "$state" | tail -1 | cut -d= -f2- || true; }
listening() { lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null || true; }
db_exists() {
  docker exec cybernetics-pg psql -U promise_graph -d promise_graph -tAc \
    "select 1 from pg_database where datname = '$db'" | grep -q 1
}
# Stops only a PID this script started (or a child of it): never a kill by name or pattern.
stop() {
  local pid=$1
  [ -n "$pid" ] || return 0
  for child in $(pgrep -P "$pid" 2>/dev/null || true); do stop "$child"; done
  kill "$pid" 2>/dev/null || return 0
  for _ in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || return 0; sleep 0.25; done
  kill -9 "$pid" 2>/dev/null || true
}

report() {
  local left=()
  for p in "$port" "$((port + 1))" $(recall dport); do
    [ -n "$(listening "$p")" ] && left+=("port $p: pid $(listening "$p" | tr '\n' ' ')")
  done
  [ -e "$dir" ] && left+=("folder $dir")
  [ -e "$gates" ] && left+=("folder $gates")
  git worktree list --porcelain | grep -qx "worktree $dir" && left+=("worktree $dir")
  db_exists && left+=("database $db")
  local procs
  procs=
  # This script and its subshells name the folder too, so skip them.
  for p in $(pgrep -f -- "$dir" 2>/dev/null || true); do
    ps -o command= -p "$p" 2>/dev/null | grep -q 'env\.sh' || procs="$procs$p "
  done
  [ -n "$procs" ] && left+=("processes that name $dir: $procs")
  if [ ${#left[@]} -eq 0 ]; then
    echo "clean: no server, driver, worktree, folder or database of this run is left"
    return 0
  fi
  printf 'LEFTOVER: %s\n' "${left[@]}"
  return 1
}

case "$cmd" in
  status)
    report
    ;;

  down)
    stop "$(recall driver)"
    stop "$(recall server)"
    # A server whose PID file was lost still listens on its port; stop it only if it runs from this worktree.
    for p in $(listening "$port"); do
      ps -o command= -p "$p" | grep -q -- "$dir" || lsof -p "$p" 2>/dev/null | grep -q -- "$dir" && stop "$p"
    done
    git worktree remove --force "$gates" 2>/dev/null || true
    git worktree remove --force "$dir" 2>/dev/null || true
    rm -rf "$gates" "$dir"
    git worktree prune
    docker exec cybernetics-pg dropdb -U promise_graph --if-exists "$db"
    if report; then rm -f "$state"; else exit 1; fi
    ;;

  driver)
    dport=${4:?usage: env.sh driver <dir> <port> <dport> [base]}
    base=${5:-http://localhost:$port}
    [ -z "$(listening "$dport")" ] || { echo "port $dport is in use" >&2; exit 1; }
    # Every inherited descriptor is closed first; a background child that keeps the caller's pipe makes it hang.
    (exec </dev/null >/dev/null 2>&1; cd "$dir" && nohup node "$here/driver.mjs" --base "$base" \
      --port "$dport" >"$dir/.qa-driver.log" 2>&1 & echo $! >"$dir/.qa-driver.pid")
    remember driver "$(cat "$dir/.qa-driver.pid")"
    remember dport "$dport"
    for _ in $(seq 1 40); do grep -q ready "$dir/.qa-driver.log" 2>/dev/null && break; sleep 0.5; done
    grep -q ready "$dir/.qa-driver.log" || { echo "driver did not start; read $dir/.qa-driver.log" >&2; exit 1; }
    echo "driver on $dport, pid $(recall driver); send scripts with: bash $here/drive.sh $dport"
    ;;

  gates)
    log=${4:?usage: env.sh gates <dir> <port> <log file>}
    [ -e "$gates" ] && { echo "$gates exists" >&2; exit 1; }
    trap 'git worktree remove --force "$gates" 2>/dev/null || true; rm -rf "$gates"' EXIT
    git worktree add --detach "$gates" "$(git -C "$dir" rev-parse HEAD)" >/dev/null
    if [ "$(uname)" = Darwin ]; then cp -cR "$dir/node_modules" "$gates/node_modules"; else cp -R "$dir/node_modules" "$gates/node_modules"; fi
    set +e
    (cd "$gates" && .claude/skills/et-gates/run-gates.sh "$gates/logs" "$((port + 1))" >"$log" 2>&1)
    rc=$?
    set -e
    echo "gates rc=$rc; $gates removed"
    ;;

  up)
    ref=${4:-phucluu/event-tracker}
    [ -z "$(listening "$port")" ] || { echo "port $port is in use" >&2; exit 1; }
    [ -e "$dir" ] && { echo "$dir exists" >&2; exit 1; }
    db_exists && { echo "database $db exists; another QA run may use port $port" >&2; exit 1; }
    src=
    while read -r w; do
      if [ -d "$w/node_modules/@playwright/test" ]; then src=$w; break; fi
    done < <(git worktree list --porcelain | awk '/^worktree /{print $2}')
    [ -n "$src" ] || { echo "no checkout with node_modules found" >&2; exit 1; }

    : >"$state"
    git worktree add --detach "$dir" "$ref" >/dev/null
    # A symlinked node_modules resolves packages from the other checkout; a clone keeps the run self-contained.
    src_nm=$(cd "$src/node_modules" && pwd -P)
    if [ "$(uname)" = Darwin ]; then cp -cR "$src_nm" "$dir/node_modules"; else cp -R "$src_nm" "$dir/node_modules"; fi
    cat >"$dir/.env.local" <<EOF
AUTH_MODE=${QA_AUTH_MODE:-local}
AVATAR_STORE=local
AVATAR_DIR=$dir/.avatars
NEXT_PUBLIC_APP_URL=http://localhost:$port
SESSION_SECRET=$(openssl rand -hex 32)
DATABASE_URL=$admin/$db
EOF
    docker exec cybernetics-pg createdb -U promise_graph "$db"
    (cd "$dir" && node --env-file=.env.local scripts/migrate.mjs >/dev/null)
    (exec </dev/null >/dev/null 2>&1; cd "$dir" && nohup ./node_modules/.bin/next dev --webpack \
      --hostname localhost --port "$port" >"$dir/.qa-dev.log" 2>&1 & echo $! >"$dir/.qa-dev.pid")
    remember server "$(cat "$dir/.qa-dev.pid")"
    code=
    for _ in $(seq 1 90); do
      code=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$port/signin" || true)
      # Demo mode redirects /signin, so any answer below 400 means the server is up.
      [ -n "$code" ] && [ "$code" != 000 ] && [ "$code" -lt 400 ] && break
      sleep 2
    done
    [ -n "$code" ] && [ "$code" != 000 ] && [ "$code" -lt 400 ] || { echo "dev server did not answer; read $dir/.qa-dev.log, then run env.sh down" >&2; exit 1; }
    cat <<EOF
ref       $ref ($(git -C "$dir" rev-parse --short HEAD))
worktree  $dir
database  $db
base      http://localhost:$port
pid       $(recall server)
clean up  bash $here/env.sh down $dir $port
EOF
    ;;

  *)
    echo "unknown command $cmd" >&2
    exit 2
    ;;
esac
