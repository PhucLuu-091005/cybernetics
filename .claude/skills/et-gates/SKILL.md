---
name: et-gates
description: Use before you report any code change in the event tracker repo as done, and before a merge - runs tsc, eslint, prettier, the provider check, vitest with the test database and Playwright, with real exit codes and the test counts.
---

# Run the gates

A task is done only when every gate passes in the task's own worktree. Report the real exit codes and the counts. Never say that a gate passed if you did not run it.

## Run

From the worktree root:

```sh
.claude/skills/et-gates/run-gates.sh <log dir> <e2e port>
```

- `<log dir>`: a folder in your scratch directory. Each gate writes `<gate>.log` there.
- `<e2e port>`: a free port, normally the dev port of the task plus 1. The script refuses 3100, 3200, 3310 and any port in use.
- `--no-e2e` as a third argument skips Playwright. Use it only for a quick loop while you work, never for the final report.

The script prints one line per gate (`tsc rc=0`), the Vitest and Playwright summary lines, and `RESULT: PASS` or `RESULT: FAIL`. Its exit code is 1 when any gate fails.

## Rules the script enforces

- Each gate writes to its own log, and the script reads `$?` of the gate itself. Never pipe a gate into `tail` or `grep` and then read `$?`: that is the status of the last command in the pipe.
- Vitest and Playwright get `TEST_DATABASE_URL`. Without it the integration tests skip, and Playwright refuses to start.

## Before you run

- Stop your own dev server of this worktree. Playwright starts its own `next dev` and writes to the same `.next` folder.
- Never run the gates in the owner's live checkout.

## Read the result

- Vitest: `Test Files N passed` and `Tests N passed`, with no `failed`. Compare N with the baseline in your brief. A lower count means that tests were lost.
- Playwright: `N passed` and no `failed` or `flaky` line, once for the main suite (`e2e`, AUTH_MODE=local) and once for the demo suite (`e2e-demo`, `playwright.demo.config.ts`, AUTH_MODE=demo). The two runs go one after the other, because both use `.next`.
- On a failure, open the log of that gate. Fix the cause, then run all the gates again. Do not report a partial rerun as a pass.

## Report

Give a table: gate, exit code, counts. Add the log directory.
