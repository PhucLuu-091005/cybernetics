---
name: et-worktree-setup
description: Use before any code task in the event tracker repo - creates the task's own git worktree, branch, Postgres database, .env.local and port, then applies the migrations. Use it for every implementer, reviewer gate run or screenshot job, never the owner's live checkout.
---

# Set up a task worktree

Every task gets its own worktree, branch, database and port. Two tasks never share a database, a port or a `.next` folder. The owner's live checkout and the owner's servers stay untouched.

## Run

```sh
.claude/skills/et-worktree-setup/setup.sh <task> <dir> <port> [base]
```

- `<task>`: short name, for example `r9` or `skills`. The script makes the branch `phucluu/et-<task>` and the database `pg_et<task>`.
- `<dir>`: an empty path in your scratch directory, for example `<scratchpad>/et<task>`.
- `<port>`: the dev port of the task. Use `<port>+1` as the e2e port.
- `[base]`: the branch to start from. The default is `phucluu/event-tracker`.

Run the script from any checkout of the repo. It reads the base checkout from `git worktree list`, so the copy of `node_modules` comes from there.

## What the script refuses

- The ports 3100, 3200 and 3310, and any port that a process listens on. The e2e port gets the same check.
- A database that already exists. Pick another task name. Never reuse `pg_et`: the owner's dev server uses it.
- A `<dir>` that exists.

## What it does

1. `git worktree add -b phucluu/et-<task> <dir> <base>`.
2. Copies `node_modules` from the base checkout (`cp -cR`, a fast clone on APFS).
3. Writes `.env.local`: `DATABASE_URL` for `pg_et<task>`, `AUTH_MODE=local`, `NEXT_PUBLIC_APP_URL=http://localhost:<port>`, and a new `SESSION_SECRET`.
4. Creates the database in the `cybernetics-pg` container and applies the migrations with `scripts/migrate.mjs`.
5. Prints the branch, the database, the dev port, the e2e port and the start command.

## After the task

- Leave the worktree and the branch in place. The controller merges them.
- Stop only the servers that you started, by PID: `lsof -nP -iTCP:<port> -sTCP:LISTEN -t`, check that the process is yours, then `kill <pid>`. Never use `pkill`, `killall` or a kill by name.
- A copied `node_modules` breaks the Turbopack build. Use `next dev --webpack`. For `next build`, do a clean install first.
