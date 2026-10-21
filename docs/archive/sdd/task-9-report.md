# Task 9 report: end-to-end tests, README and screenshots

Status: DONE_WITH_CONCERNS. All the work in the brief is complete, and every gate passes. The concerns are notes for the controller.

Branch `phucluu/et-t9`, worktree `scratchpad/et9`, base `b49998e`. Not pushed. No commit has a Co-Authored-By or AI line.

| Commit | Content |
|---|---|
| `19bec0c fix: sign-in page copy for the event tracker` | `src/app/signin/page.tsx` only. |
| `48acdde test: end-to-end tracker flows` | `tests/e2e/tracker.spec.ts`, `tests/e2e/projects.spec.ts` (new); `playwright.config.ts`; deletes `playwright.release.config.ts` and `tests/support/tls-proxy.mjs`. |
| `1400590 docs: README for the event tracker` | `README.md`; screenshots in `docs/screenshots/`. |

## E2E specs

| Spec | Tests | What it covers |
|---|---|---|
| `tests/e2e/tracker.spec.ts` | 2 | Test 1: the 13 tasks of prototype v8 section 3 as one serial flow, one `test.step` per task, at 1440 x 1000, light theme. Test 2: phone width 390 x 844 with touch. |
| `tests/e2e/projects.spec.ts` | 1 | A new project with custom teams and a first milestone, the empty graph, and its first change request merged into Main. |
| `tests/e2e/shell.spec.ts` (unchanged) | 5 | Rail, switcher, New project dialog, Settings tokens. |

The 13 steps of the walkthrough (selectors and steps come from the Task 6 `walk.mjs`):

1. The Go-live flag pop: "First planned 30 Sept", "30 Sept → 15 Oct", the reason. Esc closes it.
2. Lan drags "Where is the root cause report" onto Sync incident report: "Main is read-only", New change request, Create, URL `cr=5`, "You are editing", "1 change".
3. Lan drags the PG-203 flag: the dropped date is after 2026-10-06; Move the date stays disabled with a blank reason and with only spaces; the toast says "PG-203 Country list field type: planned finish moved."; "2 changes".
4. Share: the link ends in `/graph?cr=5`; Khoa Lê, Can edit, Add; the toast says "Khoa Lê can edit #5. Send them the link."; Khoa's access select reads `edit`.
5. Khoa: the URL stays on `cr=5`, "Lan is editing", Ask to edit, "Waiting for Lan".
6. Lan: the ask row says "Khoa Lê asks to edit #5.", Hand over, "Khoa is editing".
7. Khoa drags "Scope call" onto Dynamics CRM sync scope: the toast, the "Added a Meeting" pop, "3 changes".
8. Mark as ready: "#5 is ready. Minh Trần can merge it now.", "Ready to merge", "Locked. Waiting for Minh.", Edit again.
9. Minh: the Change requests drawer opens; #2 review, On the graph (After button), Changes, Merge into Main; the bar says "Merged into Main by Minh Trần"; the API shows #2 merged and 2 commits.
10. #3: "1 clash with Main"; Merge into Main is disabled until a pick, then enabled; the API records one resolution with `chose: 'cr'`.
11. #5 review: "Why it moves" holds Lan's reason; Request changes with a note; the API shows #5 back in draft. Khoa: "Minh Trần asked for changes", Read shows the note, Back to the graph, Mark as ready, "#5 is ready".
12. History holds #3, #2, #1 and "1 clash resolved"; See changes opens `/changes/3`.
13. History, Open graph on the last entry (`cr=1`), then a drag: "#1 is merged", "Your change goes into it", New change request. Esc closes it.

The walkthrough test also fails on any page error or console error. The run had none.

The phone test checks `scrollWidth - clientWidth = 0` on Main, on `?cr=4`, with the Add modal open, and on the review page `/changes/2`.

The projects test checks: the 3 team eye buttons ("Hide Onboarding", "Hide Engineering", "Hide QA"), the milestone label "Portal live · 20 Nov · Planned", no row, "This project has no work yet.", the Main bar with the owner, no Demo select. Then: Add a work item (the toast and the card), New change request (Mark as ready disabled with 0 changes), a drag of the card onto the Engineering drop strip (1 change, 1 row, the card leaves the Queue), Mark as ready, Review and merge ("No clashes", "Team: Engineering"), Merge into Main, then Main shows the row and History shows "Tax ID field on the KYC form: placed → Engineering".

Hydration: every navigation in the desktop tests waits until the rail's Collapse sidebar button is enabled, because drags, the Demo select and the review picks need React handlers. The phone rail hides that button, so the phone test retries the Add click with `toPass`.

Mutation check: I changed the step 10 expectation to `['main']`. The run failed at "10. Minh resolves the PG-203 name clash in #3 and merges" (rc=1, `1 failed`). I restored the file and checked it with `cmp`.

## playwright.config.ts

- `E2E_PORT` defaults to 3300 (was 3100).
- `testIgnore: 'release.spec.ts'` and its comment are gone. I also removed the comment "Every test signs in as the same local user", which was false: each spec signs in with its own label.
- `reuseExistingServer` stays `false`, and the health URL uses the same port as the server command. Playwright therefore refuses a busy port and never attaches to another server.

`playwright.release.config.ts` matched no spec, so I deleted it. `tests/support/tls-proxy.mjs` served only that release flow, so I deleted it too.

## Sign-in page

- Headline: "See every step of a project, and why the plan changed."
- Lede: "Every team, work item and event sits on one graph. A planned date keeps its first value and every move, with who moved it and why. Main changes only when its owner merges a change request."
- Hero SVG: a milestone trunk with a Go-live diamond, a done work item with Request, Handoff and Done events, a "leads from" curve to an open work item, the first and the moved planned finish flags with an arrow and the caption "Moved, with a reason", and a link to the milestone. The aria-label describes this.
- I checked it at 1440 x 900 (light and dark) and at 390 x 844 on the dev server.

## README

Rewritten sections:

- Intro and "What it does": events, work items and teams, milestones with 5 statuses, Planned finish with recorded moves and reasons, the Queue (people and agents), Main read-only, change requests with share, one editor at a time, ready, review, clashes, history.
- Screenshots with captions.
- "Demo walkthrough": the sandbox, the Demo select ("who you work as"), the 13 steps in short form, and a link to `tracker.spec.ts`.
- "Connect an agent": token, snippet, Check again, the 7 tools by scope, the Agent chip, the recipe link.
- "Local setup": unchanged steps plus `/signin?label=<name>`. The commands table loses `pnpm eval`; the e2e row names `E2E_PORT` (default 3300) and says to stop a dev server in the same checkout first.
- "Deploy on Render": a new paragraph says that the tracker needs a fresh database (migration 0004 adds the tracker, 0005 drops the promise data; an old account keeps a project with no tracker; the sandbox seed runs on first sign-in), with the steps for an existing deployment. Step 2 no longer says "no later than 15 October". Step 7 is the 13-step walkthrough plus one agent Queue add.
- Removed: "Release checks" (links to the deleted release spec and config), "Measured results" (300-loop layout, the removed graph API, the offline eval) and the "137 records and 36 reviewed loops" sentence.
- "Known limits": no sync, demo members, no revert, free hosting, one instance.

The README has no em dash or en dash (checked with grep).

## Screenshots

From my own dev server: `next dev --webpack` on port 3240, database `pg_et9` (dropped, created, migrated 0000 to 0005). Playwright library script `scratchpad/et9-shots/shots.mjs`, light theme. I stopped the server before any Playwright run, restored `next-env.d.ts`, and removed the ignored `AGENTS.md`, `.next` and `tsconfig.tsbuildinfo`. Ports 3100 and 3240 were not used by Playwright; port 3100 was never touched.

| File | Viewport | Content |
|---|---|---|
| `docs/screenshots/tracker-main.png` | 1440 x 900 | Larkspur Main with the Queue, the Demo select and the legend. |
| `docs/screenshots/date-moves.png` | 1440 x 900 | The Go-live date pop: first planned 30 Sept, moved 1x, the reason, Move the date. |
| `docs/screenshots/change-request.png` | 1440 x 900 | Lan's #5 with the Changes drawer: the Queue event and the PG-203 date move with its reason. |
| `docs/screenshots/review-clash.png` | 1440 x 900 | The #3 review: "1 clash with Main" on the PG-203 name, Merge into Main disabled. |
| `docs/screenshots/history.png` | 1440 x 900 | Main history with #3 (1 clash resolved), #2 and #1. |
| `docs/screenshots/agent-tokens.png` | 1440 x 900 | Settings: 2 permissions, the snippet, a created token. The script replaced the shown secret with `inv_xxx…` before the shot. |
| `docs/screenshots/phone.png` | 390 x 844, scale 2 | Main at phone width: the Queue above the graph. `scrollWidth 390 = clientWidth 390`. |

Removed: `graph-loop-panel.png`, `review-queue.png` (promise graph screens). `agent-tokens.png` is retaken.

## Gates (logs in `scratchpad/et9-logs/`)

| Gate | Exit | Summary line |
|---|---|---|
| `tsc --noEmit` | 0 | no output (`tsc-final.log`, on HEAD `1400590`) |
| `eslint .` | 0 | no output (`eslint-final.log`) |
| `prettier --check .` | 0 | "All matched files use Prettier code style!" (`prettier-final.log`) |
| `vitest run` with `TEST_DATABASE_URL` | 0 | "Test Files  41 passed (41)", "Tests  519 passed (519)" (`vitest.log`) |
| `playwright test` with `E2E_PORT=3300` | 0 | "8 passed (1.8m)" (`e2e-full.log`) |

The vitest and Playwright runs used the same test files as the commits (the README and the commit split came after; `cmp` confirms the spec). The first Playwright run of the 2 new specs alone also passed: "3 passed (1.2m)" (`e2e-1.log`).

## Concerns

1. The README step for an existing Render deployment (delete the old database, sync the Blueprint so that Render creates a new empty `promise-graph-db`) is not tested on Render.
2. I removed the "Measured results" section because its numbers measured removed code. The README has no timing numbers for the tracker now.
3. Steps 9 to 11 also read `GET /api/v1/projects/:id/tracker` through `page.request` to check the merge, the recorded pick and the draft status. The rest of the flow checks only the UI.
4. The phone screenshot shows the sticky bin over the row labels at 390 px. This is the Task 6 layout (decision 4), not a change in this task.
5. The first screenshot of the sign-in page caused one hydration warning: Playwright added `caret-color: transparent` to an input before React hydrated. It is an artifact of the screenshot, not an app bug. The e2e runs had no console error.
6. The dev database `pg_et9` stays on the local PostgreSQL. `.env.local` in `et9` points to it.

## Fix round 1 (review minors)

Status: DONE. Branch `phucluu/et-t9`, not pushed, no AI attribution line.

`git merge --no-edit phucluu/event-tracker` was a fast-forward from `1400590` to `cd82fc2`, because that branch already holds `phucluu/et-t9`. No merge commit and no conflict.

| Commit | Content |
|---|---|
| `7cd500d fix: sign-in labels, README sign-in labels and e2e helpers` | The review minors (below). |
| `6b53043 docs: retake the phone and change request screenshots` | `docs/screenshots/phone.png`, `docs/screenshots/change-request.png`. |

### Fixes

- Sign-in hero: the first event label is "Message" (was "Request").
- Sign-in footer note: the sentence "Main changes only when its owner merges a change request." is gone; the lede keeps it.
- README, Local setup step 4: "`/signin?label=<label>` signs in a separate local user with its own sandbox. A label is 1 to 40 lowercase letters, digits or hyphens, for example `/signin?label=lan-test`. The sign-in page ignores any other label and uses the default local user." This matches `LabelSchema` (`^[a-z0-9-]{1,40}$`) in `src/server/http/session.ts` and the check in `src/app/signin/page.tsx`.
- New `tests/e2e/helpers.ts`: `hydrated`, `centerOf`, `drag` and the `Point` type. Both specs import them; the copies in the specs are gone. Playwright does not run `helpers.ts` as a spec (default `testMatch`).
- Step 10, after Merge into Main: the bar contains "#3" and "Merged into Main by Minh Trần".
- Step 11, after Send back to draft: the toast says "#5 is a draft again. Khoa Lê sees your note.", the header chip reads "Draft", the draft callout shows, and the "This change request changed since you opened it." banner does not show.

### Final fixes and the specs

The merged fixes ("+ New team" pill, skipped-change cards, the review "changed" banner, conflict toasts, a used queue card stays in the queue) changed no text or flow that the specs use. The 2 new specs passed on the merged code before I changed them: "3 passed (1.0m)" (`e2e-fix-1.log`).

### Screenshots

Dev server `next dev --webpack` on port 3240, `pg_et9` dropped, created and migrated again; the same `shots.mjs`. I stopped the server before the Playwright runs, restored `next-env.d.ts`, and removed `.next` and `AGENTS.md`.

- `phone.png`: the script now scrolls, 2 px at a time, to the first spot where the sticky bin overlaps no SVG text (with 4 px of margin). That spot is `scrollY 442`: the bin sits under "Client secret renewal", and the shot shows every row label of the graph. `scrollWidth 390 = clientWidth 390`.
- `change-request.png`: it now shows the "+ New team" pill under the IT lane.
- A pixel diff against the committed files found no other visible change. `tracker-main`, `date-moves` and `review-clash` have 0 different pixels. `history` differs only in the merge times, and `agent-tokens` only in the token prefix. I kept those files.

### Gates on the fix tree (logs in `scratchpad/et9-logs/fix-*.log`)

| Gate | Exit | Summary line |
|---|---|---|
| `tsc --noEmit` | 0 | no output |
| `eslint .` | 0 | no output |
| `prettier --check .` | 0 | "All matched files use Prettier code style!" |
| `vitest run` with `TEST_DATABASE_URL` | 0 | "Test Files  44 passed (44)", "Tests  538 passed (538)" |
| `playwright test` with `E2E_PORT=3300` | 0 | "8 passed (1.3m)" |

The gates ran on the same files that the 2 commits hold; nothing changed between the runs and the commits.
