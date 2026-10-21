---
name: et-qa
description: Use when the owner asks to QA or test the event tracker app (every screen, button or flow), to record an owner demo video, or for a QA report, for example "đóng vai QA", "test lại mọi màn hình", "quay video demo", "/et-qa members". Takes an optional scope; no scope means a full QA.
---

# QA the event tracker

A run tests the app in its own environment and writes one run folder: a Vietnamese HTML report, screenshots and, for some scopes, a demo video. Scripts do the repeatable part. You do the manual part and judge every finding.

## Scope

No argument means `full`. An unknown word, a typo included: ask the owner and suggest the nearest scope. Run nothing until they answer.

| Scope | Gates | Areas for `checks.mjs` | Sweep | Manual | Video |
|---|---|---|---|---|---|
| `full` | yes | all | all pages | inventory list | yes |
| `smoke` | no | `auth,shell` | `graph,members,settings/tokens` | no | no |
| area list | no | those | their pages | no | no |
| `demo` | no | none | no | no | yes |
| `gates` | yes | none | no | no | no |

Pages per area: `cr` → `changes/2,changes/4`; `members` → `members`; `settings` → `settings/tokens`; every other area → `graph`.

The table gives the defaults; a modifier adds its step to any row. Skip each step that the row says no to. A run that is not `full` is complete when every step of its row ran, the report exists, and `env.sh down` printed `clean`.

Areas: `auth`, `shell`, `project`, `graph`, `cr`, `collab`, `members`, `settings`, `access`, `api`, `phone`, `mcp`, `profile`, `fresh`, `visitor`. Modifiers: `+video`, `+gates`, `+live`, `ref=<git ref>` (default `phucluu/event-tracker`), `out=<root>`, `live=<url>`.

`visitor` needs a server in demo mode, so a run without it skips it. `full` runs it on a second server (step 3b).

## Paths

- `K`: the absolute path of the `scripts/` folder next to this file. `coverage.md` and `reference.md` sit next to this file too.
- `<run>`: a new path in your scratch directory. Run the scripts of `K` and `.claude/skills/…` paths from `<run>`. Pass absolute paths.
- `P`, `P+1`, `D`: three free ports for the server, the gates and the driver (never 3100, 3200 or 3310). `Q`: one more free port for the demo-mode server.
- `<root>`: `out=`, or `qa-video/` in the directory where the session started.
- `<out>`: `<root>/<YYYY-MM-DD_HHmm>-<slug>/`, new for every run, where `<slug>` is the scope with `,` and spaces as `-` and no `+` (`members,settings +video` → `members-settings-video`). Never write into an older run folder. Never `git add` it.
- `<sha>`: the short commit that `env.sh up` prints.

## Clean up: always

`bash $K/env.sh down <run> <P>` ends every run. It stops the server and the driver, removes the gates worktree and `<run>`, drops `pg_qa_<P>`, and then checks that nothing is left.

- Run it also when you stop early, when a step fails, and when the owner interrupts.
- It must print `clean`. If it prints `LEFTOVER`, fix each line and run it again; `bash $K/env.sh status <run> <P>` only checks.
- Start the server, the driver and the gates only through `env.sh`, so `down` knows their PIDs. Never kill by name or pattern.

## Steps

1. `bash $K/env.sh up <run> <P> [ref]`: a detached worktree, the database `pg_qa_<P>` and a dev server.
2. `bash $K/env.sh gates <run> <P> <out>/gates.txt`: every gate in its own worktree on `P+1` (Playwright must not share `.next` with your server), which it removes after. A failed gate does not stop the run; the report shows it.
3. `node $K/checks.mjs --base http://localhost:<P> --out <out> --areas <areas>`: one call for all the areas. A call without `--append` overwrites `results.json`.
   - 3b. Full scope or `visitor`: `QA_AUTH_MODE=demo bash $K/env.sh up <run>-demo <Q> [ref]`, then `node $K/checks.mjs --base http://localhost:<Q> --out <out> --areas visitor --demo --append`. Run `env.sh down <run>-demo <Q>` in step 9 too.
   - 3c. `+live` (the deployed app, in demo mode): `node $K/checks.mjs --base <live url> --out <out>/live --areas shell,project,graph,cr,collab,members,settings,access,api,phone,mcp,profile,fresh,visitor --demo --tag live --video <out>/live/video`. Run it first locally against a demo-mode server: a check that passes there and fails on live is a finding or a timing trap. The list makes about 22 demo copies. The app allows 30 per clock hour per address, so count every copy of the hour (the tour, the driver, a rerun) and wait for the next hour when the count reaches 26. Never run a load test or a cleanup script on the live database. Merge `live/results.json` into `results.json` with the shot paths under `live/`.
   - `--video <dir>` writes one video of the run: each check's caption is on screen, and the video holds only the time of the checks. The result of each check gets `videoAt`.
4. `node .claude/skills/et-ui-qa/shoot.mjs --base http://localhost:<P> --out <out>/shots --pages <pages>`. Open every image and check the UI rules of AGENTS.md.
5. Full scope only: `node $K/inventory.mjs --out <out>`. It lists what no script presses. Test each "Manual" item and each "Uncovered" item with the driver (`bash $K/env.sh driver <run> <P> <D>`, then `bash $K/drive.sh <D>`). Record each result in `<out>/manual.json`. For an uncovered item, also add a check to `checks.mjs` or an entry to `coverage.md`.
6. Video: `node $K/demo.mjs --base http://localhost:<P> --out <out>/demo` (local sign-in). For an app in demo mode, the deployed one included, `node $K/tour.mjs --base <url> --out <out>/tour` records the full feature tour with English captions, a cursor circle before each click and a reading pause between features; it makes 2 demo copies. Run the tour locally first. Look at every image in `tour/shots/`.
7. Write `<out>/findings.json`. Confirm each check FAIL by hand first: a FAIL can come from a changed selector.
8. `node $K/report.mjs --out <out> --scope "<scope as the owner wrote it>" --ref "<ref> @ <sha>" --summary "<2-3 câu tiếng Việt>"`. It also rebuilds `<root>/index.html`. Open the report and look at it.
9. `bash $K/env.sh down <run> <P>` until it prints `clean`. Keep `<out>` out of git.

A full QA is complete only when the inventory shows 0 uncovered, every manual item has a result in `manual.json`, every area ran, and `env.sh down` printed `clean`.

Read `reference.md` before step 5, and when a check or a click fails. It holds the traps, the API list, and the JSON formats.

## Report to the owner

In Vietnamese, starting with `✓ `: the absolute path of the report and of `<root>/index.html`, the count per severity, the top findings, what you did not test, and the `clean` line of `env.sh down`.
