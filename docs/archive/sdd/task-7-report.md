# Task 7 report: review screen for a change request

Status: DONE_WITH_CONCERNS. The screen is complete. Its actions need the Task 4 route `POST /tracker/crs/[num]/actions`. Before Task 4 merges, each action gets 404 and the screen shows the toast "Request failed with status 404".

Commit: `c506297 feat: change request review screen with changes, graph and conversation` on `phucluu/et-t7` (worktree `scratchpad/et7`). Not pushed. The commit has no AI attribution line.

## What I built

| File | Content |
|---|---|
| `src/tracker/review.ts` | Pure `reviewModel(payload, num, picks)` and the types `ReviewModel`, `ReviewChange`, `ReviewClash`. |
| `src/components/tracker/ReviewScreen.tsx` | `ReviewScreen({payload, projectId, num, initialTab})` and the type `ReviewTab`. Internal parts: `ChangeList`, `DiffCard`, `ClashBox`, `CommentBox`, the `TLK` labels. |
| `src/components/tracker/review.css` | The prototype `.cs-*`, `.pr-*`, `.dcard`, `.dline`, `.dquote`, `.dfoot`, `.res-box`, `.res-item`, `.conf`, `.ask-box`, `.seg`, `.box`, `.tl`, `.cmt` rules under `.tk`. A new token `--page` (light `#f6f6f6`, dark `#050505`, as the prototype). |
| `src/app/(app)/projects/[id]/changes/[num]/page.tsx` | Reads the `pg_act_<projectId>` cookie, calls `getTrackerPayload`, and renders `ReviewScreen`. `?tab=changes\|graph\|talk` picks the first tab. A bad id, a bad number or an unknown CR gives 404. A project with no tracker shows "This project has no tracker yet." |
| `tests/unit/tracker/review-model.test.ts` | 11 tests for `reviewModel`. |

I changed no existing file. `TrackerGraph` already has the `focusRow` and `focusMs` props, and `api.ts` already has `crAction(projectId, num, action)` with `expectedRevision` required for merge, close and request-changes. `src/tracker/index.ts` does not export `review.ts`; the screen imports `../../tracker/review` directly, so Task 6 and Task 7 cannot conflict on that file.

## The model

`reviewModel(payload, num, picks)` returns `null` for an unknown number. Otherwise it returns:

- `cr`, `owner` (the acting member owns Main).
- `before`, `after` (TrackerState), `marks` (the violet rings of After).
- `changes`: one `ReviewChange` per change, with `op`, `d` (described against Before), `skipped`, `opIndex` (the index in `cr.ops`, which the server checks for per-change comments), `workItemId` (the yellow row), `title` (the work item name in After), `milestoneId` (the glowing diamond), `event` (the quote, from After) and `clash`.
- `clashes`: `ReviewClash` = `Clash` plus `label` (`clashLabel` on Main at `x.rev`, as the server), `fromAuthor` (author of the Main change), `mainVal`, `crVal`.
- `picks`: only the picks of current clashes, so a merge never sends a stale key that the server rejects.
- `canMerge`: status Ready, the owner, at least 1 live change, and a pick for every clash.
- `dropped`: on a merged CR, the resolutions with `chose: 'main'`.

The states follow ruling 1:

| CR status | Before | Changes | After |
|---|---|---|---|
| Draft or Ready | latest Main | `liveOps(cr.ops, commits)` | latest Main plus `liveOps(cr.ops, commits, picks)` |
| Merged | Main at `mergedRev - 1` | the ops of the commit at `mergedRev`, mapped back to `cr.ops` by `sameOp` | Main at `mergedRev` |
| Closed | Main at `closedRev` | `cr.ops` | Main at `closedRev` plus `cr.ops` (the prototype and `crState`) |

## The screen

- Header: crumb "← Back · Change requests · #N", title with the status chip, the author line per status (the prototype text), "With" and the editors, the clash chip ("N clashes with Main" or "No clashes") on open CRs.
- Owner on a Ready CR: Close without merging, Request changes (opens "What should change?" with the prototype placeholder; an empty note gives "Write what should change."), Merge into Main (disabled until every clash has a pick). Everybody else sees Back to the graph.
- Clash box: radio cards "Main now · from #N by X" and "This change request · by Y" for the owner on a Ready CR. Other people see read-only cards and the text "<owner> picks a version when merging."
- Resolved before merge box on merged CRs. Draft note on drafts.
- Tabs with counts. The tab goes into the URL with `history.replaceState`. The tabs use `role="tablist"`, and the arrow keys move between them.
- Changes tab: the side list (Viewed progress on open CRs, else "Pick a change to find it on the graph."), diff cards with red and green lines, the event quote, "Why it moves" with the person who moved the date, per-change comments, Show on graph, Viewed (open CRs only), and the "Not merged" cards on merged CRs.
- On the graph tab: Before and After with `TrackerGraph` (edit off). After passes the marks, the yellow focus row and the glowing milestone of the picked change. The eye toggles, folds and chips use the viewer's hidden rows in `localStorage`, as on the graph screen. A click on a row or an event does nothing, as in the prototype.
- Conversation tab: the timeline with the `TLK` labels ("commented on a change" for a comment with `opIndex`), and a comment box.
- Polling: `ReviewScreen` reuses `useTracker` from `TrackerScreen` (5 seconds, visible page only).
- Actions (ruling 3): Merge sends `{action: 'merge', picks, expectedRevision: cr.revision}` and goes to `/projects/[id]/graph?cr=<num>`. Close sends `{action: 'close', expectedRevision}` and goes to the same place. Request changes sends `{action: 'request-changes', note, expectedRevision}`, stays, and shows "#N is a draft again. <editor> sees your note." A comment sends `{action: 'comment', body, opIndex}`. After a 409 the screen shows the server message and loads the payload again, so the owner sees what changed.

## Tests and gates

Logs are in `.superpowers/sdd/2026-10-16-event-tracker/logs/task-7-*.log`.

- RED 1: `vitest run tests/unit/tracker/review-model.test.ts` gave rc=1, "Test Files 1 failed", because `src/tracker/review` did not exist (`task-7-red.log`).
- RED 2: with a stub that returns `null`, the same command gave rc=1, 10 tests failed (`task-7-red-stub.log`). The 11th test expects `null`.
- GREEN: rc=0, `Tests 11 passed (11)` (`task-7-green.log`). On the first green run 1 test failed because my test data was wrong (event `p31` is by Lan, not Quang); I corrected the test.
- Mutations (`task-7-mutations.log`): I put 11 bugs into `review.ts`, one at a time, and restored the file after each run. 10 bugs failed 1 or 2 tests at once. "Closed Before at latest Main" passed at first, because the test closed the CR at the latest revision. I made the test merge another CR after the close; then the bug failed 1 test.
- `vitest run tests/unit/tracker`: rc=0, `Test Files 8 passed (8)`, `Tests 245 passed (245)`.
- Full `vitest run` without `TEST_DATABASE_URL`: rc=0, `Test Files 61 passed | 21 skipped (82)`, `Tests 690 passed | 210 skipped (900)`. The skipped files are the database integration tests. This task changes no server code.
- `tsc --noEmit`: rc=0, no output. `eslint .`: rc=0, no output. `prettier --check .`: rc=0, "All matched files use Prettier code style!".
- `next build --webpack`: rc=0, the route `ƒ /projects/[id]/changes/[num]` builds. The default Turbopack build fails in this worktree with "Symlink node_modules could not be resolved", because `node_modules` is a symlink to another scratchpad folder.

## Manual check on the dev server

I applied the migrations to `pg_et7` with `drizzle-kit migrate`. Dev server: `next dev --webpack --hostname localhost --port 3210`, stopped at the end. I restored `next-env.d.ts` and deleted the `AGENTS.md` that `next dev` wrote (git ignores it). Screenshots come from the Playwright library API; I ran no e2e spec. Scripts: `scratchpad/et7-shots/shoot.mjs`, `flow.mjs`, `flow2.mjs`, `okcheck.mjs`, `proto2.mjs`.

1. Without the Task 4 routes (`scratchpad/et7-shots/out1/`): `01` #2 Changes as the owner, `02` On the graph with the yellow PG-204 row (1 `.hit.focus`), `03` Before (0 focus rows), `04` Conversation, `05` and `06` Request changes and "Write what should change.", `07` Viewed progress, `08` Merge gives the 404 toast, `09` merged #1 with the event quote and "Why it moves", `10` `?tab=graph` opens the graph tab, `11` and `12` draft #4, `13-phone-*` 390 px, `14` dark theme. `/changes/99` gives 404.
2. With the Task 4 route files copied in for the check only (`act-as.ts`, `tracker/route.ts`, `crs/[num]/actions/route.ts` from `phucluu/et-t4`, deleted before the commit, stale `.next/dev/types` removed), on a fresh database (`scratchpad/et7-shots/out2/`): a per-change comment and a general comment (`20`); Request changes keeps the page, #2 becomes a draft, and the toast names Lan (`21`); Lan marks #2 ready through the API and the poll shows Merge within 15 seconds; Merge goes to `graph?cr=2` (`22`); #3 shows the clash, Merge is disabled until a pick (`23`), After shows Main's name (`24`); Quang raises the revision through the API, and Merge gives 409 with "#3 changed. Reload it and try again." (`25`); after a new pick Merge works; merged #3 shows Resolved before merge, 1 change and the "Not merged" card (`26`), and its Conversation has no comment box (`27`); Hà marks #4 ready, Close goes to `graph?cr=4`, and #4 shows Closed (`28`); Lan sees merged #2 without owner buttons (`29`).
3. `scratchpad/et7-shots/out3/`: Lan on Ready #3 sees read-only clash cards (0 radios, no Merge button) (`30`); the clash box at 390 px (`31`); the msDate change of #1 makes the Go-live diamond glow (`32`); ArrowRight and ArrowLeft move between the tabs; the IT eye folds the team in the review graph (`33`); the merged bubble keeps the ink colour after the `.ok` fix (`34`).
4. Phone width: `scrollWidth 390 = clientWidth 390` for #2 Changes, #2 On the graph, #1 Changes, #4 Conversation and #3 with the clash box.
5. Console: no hydration warning and no React error from the review screen. The only errors are the expected 404 and 409 responses, and the Next.js 404 page for `/changes/99` logs "Encountered a script tag".
6. I reset `pg_et7` 3 times between runs (drop schema, migrate, sign in). The final state: #2 merged, #3 Ready with the clash, #4 draft.

## Decisions and deviations (the controller must check these)

1. Comment boxes show only on open CRs and only for a person with a member. The prototype shows them on merged CRs too, but the server returns 409 (merged or closed) or 403 (no member).
2. A closed CR shows Main at `closedRev` plus its ops. The rulings name only merged and open CRs; the prototype and `crState` use this rule.
3. Per-change comments use the index in `cr.ops`, because the server checks `opIndex` against `cr.ops`. The prototype uses the position in the shown list, which differs when Main already has a change.
4. "← Back" and "Back to the graph" go to `/projects/[id]/graph?cr=<num>`. The prototype closes the overlay and returns to the earlier view.
5. Close without merging has no Undo, because no action reopens a closed CR. The prototype toast offered Undo.
6. Merge and Close go to the graph at once, so the prototype success toasts do not show.
7. The page has its own copy of the `trackerPayload` helper of the graph page, so I did not touch the Task 5 page. A shared helper can replace both copies later.
8. The CSS neutralises the old global `.seg`, `.conf` and `.ok` rules inside `.tk`. Task 8 can drop these overrides when it deletes the old CSS.
9. Each diff line has a visually hidden "Before: " or "After: " for screen readers, because the − and + come from CSS.

## Concerns

1. The actions need Task 4. After Task 4 merges, repeat flow 2 without the copied files.
2. `ReviewScreen` imports `useTracker` from `TrackerScreen.tsx`. If Task 6 changes that hook, the merge must update `ReviewScreen`.
3. New comments show the real time (16 Oct) while the demo clock is 9 Oct. This is Task 3 concern 3.
4. Close without merging closes the CR with one click and no confirmation, as the prototype does but without its Undo.
5. The database integration tests did not run (no `TEST_DATABASE_URL`). This task changes no server code.

---

## Fix round 1 (review findings)

Commits on `phucluu/et-t7`: `9fd6afb Merge branch 'phucluu/event-tracker' into phucluu/et-t7` (no conflicts; it brings the Task 4 routes and the Task 5 fixes), then `d6a3674 fix: review screen close confirmation, stable keys and focus`. Not pushed. No AI attribution line.

| # | Finding | Fix |
|---|---|---|
| 0 | Hydration clock | The page passes `serverNow={serverMinute()}`, as the graph page does. `ReviewScreen` takes `serverNow` and calls `useNow(serverNow)`. |
| 1 | Close without merging sent at once | The button opens an inline box "Close #N without merging?" with Close and Cancel (`#rv-close`, `aria-controls` and `aria-expanded` on the button). Cancel gets the focus, so an Enter right after the first press does not close the CR. The Close box and the Request changes box exclude each other. |
| 2 | Keys of resolution rows and dropped cards | Both use the array index. |
| 3 | Copied clock helpers | Deleted. `TrackerScreen.tsx` now exports `useNow` (one word: `export`). |
| 4 | Focus of the note | The textarea gets the focus when Request changes opens. The button has `aria-controls="rv-ask"`. |
| 5 | Draft with a clash | New test "reports the clash of a draft but never lets the owner merge it": the clash, its change, the kept pick and the After name show, and `canMerge` stays false for the owner. |

### Evidence

- The new test passed on its first run, because the model already handled a draft. To prove that it catches defects, I put 2 bugs into `review.ts` one at a time and restored the file after each run (`logs/task-7-mutations.log`, lines "fix1"): "a draft can merge" failed 2 tests, and "a draft has no clashes" failed 1 test (the new one).
- `vitest run tests/unit/tracker`: rc=0, `Test Files 8 passed (8)`, `Tests 249 passed (249)` (`logs/task-7-fix1-tracker.log`).
- `tsc --noEmit` rc=0, no output. `eslint .` rc=0, no output. `prettier --check .` rc=0, "All matched files use Prettier code style!" (`logs/task-7-fix1-*.log`).
- Dev server on port 3210 with the real Task 4 routes and a fresh `pg_et7` (`scratchpad/et7-shots/flow3.mjs`, screenshots in `scratchpad/et7-shots/out4/`):
  - Comments: a per-change comment and a general comment (`20`).
  - Request changes: the focus goes to `rv-note`, the button has `aria-controls` `rv-ask`, the page stays, #2 becomes a draft, and the toast names Lan (`21`).
  - Merge: Lan marks #2 ready through the API, the poll shows Merge, and Merge goes to `graph?cr=2` (`22`).
  - Merge with picks: Merge on #3 stays disabled until a pick (`23`, `24`). A stale revision gives 409 and "#3 changed. Reload it and try again." (`25`). After a new pick the merge works, and #3 shows Resolved before merge in ink colour and the "Not merged" card (`26`, `27`).
  - Close: the box shows "Close #4 without merging?" and Cancel has the focus (`28a`). Cancel removes the box, and #4 stays Ready to merge. Close then goes to `graph?cr=4`, and #4 shows Closed (`28`).
  - The console showed no hydration message. The only error line is the expected 409.
- I stopped the dev server, restored `next-env.d.ts` and deleted the generated `AGENTS.md`.

### Concerns

1. `TrackerScreen.tsx` now exports `useNow`. If Task 6 edits the same line, the merge needs the `export` keyword kept.
2. The rest of the earlier concerns stay open: the demo clock against new comments (Task 3), and the database integration tests that I did not run.
