# Linear Tickets Design

Date: 14 October 2026. Status: draft for owner review. Target: a new PR "9/9 Linear tickets as child loops" from branch `phucluu/linear-tickets`, based on `phucluu/promise-graph` (PR #1) after the graph declutter work merges forward.

Depends on: [Graph declutter design](2026-10-14-graph-declutter-design.md) (source icons, domain-based links, layout offsets). Visual reference: [mockup](../../design/2026-10-14-linear-tickets.html).

## 1. Owner decisions (14 October 2026)

| # | Question | Decision |
|---|---|---|
| 1 | How does the board show a promise that becomes developer tickets? | Each ticket is a child loop of the promise loop. The parent shows progress ("3/5"). A click expands the children under the parent. |
| 2 | How do Linear tickets enter the app? | Through an external agent over MCP, with the existing `import_records` and `update_proposal` tools. The app stores no Linear credentials. |
| 3 | How does the app know the source app and the link? | From the permalink domain (`linear.app` gives the Linear icon and a clickable link). The declutter design defines the rule. |

## 2. Scope

In scope:

- An optional `parentLoopId` on a loop, with reference rules.
- Layout and UI for parents and children: progress chip, expand and collapse, list view, loop panel, loop editor, review text.
- The agent recipe for Linear: record mapping, act mapping and an example batch.
- Demo data: one promise with five Linear tickets, plus real-domain permalinks for the demo Slack and Gmail records.

Out of scope:

- A native Linear connector, webhooks or a Linear API key in the app.
- More than one level (a ticket cannot have tickets).
- A parent state that derives from its children. The parent keeps its own acts and state.
- Milestone counts that include tickets.
- Keyboard focus on the progress chip. Keyboard users expand tickets from the loop panel.

## 3. Data model

### 3.1 Schema

`LoopSchema` in `src/contracts/graph.ts` gets one optional field:

```ts
parentLoopId: IdSchema.optional(),
```

- A top-level loop has **no** `parentLoopId` key. Never store `null` and never build `{ parentLoopId: undefined }`:
  - `canonicalJson` throws on `undefined`, and every mutation receipt hashes its input.
  - `diffSnapshots` compares `canonicalJson`, so `null` in one snapshot and an absent key in another reads as a change and can cause a false rebase conflict.
- Code that copies a loop uses a conditional spread: `...(parentLoopId ? { parentLoopId } : {})`.
- Old snapshots stay readable, and their hashes stay the same, because `canonicalJson` writes only keys that exist and no read path re-parses stored snapshots.
- This is a one-way step. Code from before this change rejects a snapshot with the key on every write path (`LoopSchema` is a strict object). A rollback after tickets exist blocks updates, merges, reverts and restores.
- `schemaVersion` stays `1`. Nothing reads it, and the change only adds an optional key.
- Tickets count toward the 300-loop snapshot cap.

### 3.2 Reference rules

The rules go into `referenceErrors` in `src/server/graph/references.ts`, next to the existing loop references. That function feeds `validateSnapshot` and `compositionConflicts`, so rebase previews and revert previews report a broken rule as a conflict, not only as a late validation error.

For each loop with `parentLoopId`:

1. The parent exists. Message: the existing "references missing loops entity" text.
2. The parent is not the loop itself: "parentLoopId cannot name the loop itself."
3. The parent has no `parentLoopId`: "parentLoopId must name a top-level loop; {parent} is a ticket."
4. The loop has `milestoneId: null`: "A ticket takes no milestone; its parent loop carries the milestone."

For each milestone: `anchorLoopId` cannot name a ticket: "anchorLoopId cannot name a ticket loop."

Removing a parent that still has tickets leaves the tickets with a missing reference. The proposal, rebase or revert then reports the conflict on each ticket. Removal does not cascade.

### 3.3 Engine

The engine does not change. A ticket is a loop: it has its own acts, state and breakdowns, and `engine.counts` includes it. The browser derives ticket progress from `engine.loops`:

- `done` = tickets whose state is `delivered` or `closed`.
- `total` = tickets whose state is not `declined` or `cancelled`.
- `broken` = at least one ticket has a breakdown with severity `broken`. `warning` = at least one ticket has a breakdown and none is broken.

## 4. Layout

### 4.1 Options and contract

- `LayoutOptionsSchema` gets `expandedLoopIds: z.array(IdSchema).default([])`.
- `BranchLayoutSchema` gets:
  - `parentLoopId: IdSchema.nullable()`: null for a top-level branch.
  - `forkY: coordinate`: the y where the fork and merge curves start and end. It is `trunkY` for a top-level branch and the parent's line y for a ticket.
  - `tickets: z.strictObject({ done, total, broken: z.boolean(), warning: z.boolean(), expanded: z.boolean() }).nullable()`: null for a loop with no tickets.
- `branchPath(xStart, xEnd, y, forkY, merge)` from the declutter work already takes the fork y as its fourth argument.

### 4.2 Placement

- A ticket of a collapsed parent produces no branch. A ticket whose parent is not in the layout input (filtered out) produces no branch.
- Packing works on blocks. A block is a top-level loop plus, when the loop is expanded, its tickets. A block needs `1 + tickets` consecutive rows in the parent's lane. `packRows` places the block in the first run of rows that are free from `xStart - gap` on.
- Tickets take the rows after their parent's row, in start order. Rows grow away from the trunk, as today.
- A ticket sits in its parent's lane, even when its performer department differs. This is the one exception to "one lane per performer department". When titles show (zoom 60 % or more), the ticket title shows its department when it differs: "PG-118 Dynamics CRM sync job · Engineering".
- A ticket's fork curve starts on the parent's line. A closed ticket merges back into the parent's line.
- The block's x range covers the parent, its tickets and the chip (4.3), so the next block in the row never touches it.
- Keyboard navigation order: an expanded parent, then its tickets in start order, then the next branch.

### 4.3 Progress chip

- A parent with tickets shows a chip at the end of its line: x = `xEnd + 8` (`xEnd + 20` when the parent merges into the trunk, so the merge curve stays clear), centred on the line. Size: 50 × 16 layout px; it scales with the canvas zoom and shows at every zoom.
- Text: `▸ 3/5` when collapsed, `▾ 3/5` when expanded. A red dot on the chip when `broken`, an amber dot when `warning`.
- The chip is an SVG `<g role="button">` with `aria-expanded` and the label "Show 5 tickets, 3 done" or "Hide 5 tickets, 3 done". It has `tabIndex={-1}`, so Tab keeps its order. The loop panel gives keyboard users the same toggle (5.3).
- A click on the chip toggles the parent in the expanded set. It does not select the loop.

### 4.4 Interaction with dragged positions

- `applyLayoutOffsets` moves a parent's line as before. It then sets `forkY` of each visible ticket of that parent to the parent's new y, and rebuilds the ticket paths.
- A ticket can be dragged like any branch. Its line stays inside the parent's lane.

## 5. User interface

### 5.1 Graph screen

- `GraphScreen` holds `expanded: Set<string>` in React state. It is not saved; a reload collapses all parents.
- Filters: a parent stays visible when it or any of its tickets matches the filters. An expanded parent shows all its tickets.
- The coverage line counts top-level loops only, then adds the tickets: "30 loops: … · 5 tickets, 2 open".

### 5.2 List view

Each ticket row follows its parent row, indented, with a "↳" mark. The list view always shows tickets.

### 5.3 Loop panel

- Parent: a "Tickets (3/5 done)" section lists each ticket: source icon of its latest cited record, title, state, department, and the link of that record (the declutter link rule). A button "Show tickets on graph" or "Hide tickets on graph" toggles the parent in the expanded set. A click on a ticket title selects that ticket.
- Ticket: a line "Part of {parent title}" at the top. A click selects the parent.

### 5.4 Editing and review

- `LoopEditor` keeps `parentLoopId` when it saves (today it rebuilds the loop and drops unknown fields). It gets a "Parent loop" select: "None" plus every top-level loop except the loop itself. The select is disabled for a loop that has tickets. A chosen parent clears and disables the milestone select.
- `describe.ts` labels the field "parent loop" and shows the parent's title, like `loopId`.

## 6. Linear import through the agent

The agent recipe (`docs/mcp-agent-recipe.md`) gets a section "Tickets from Linear". The agent reads Linear with its own credentials (for example the Linear MCP server) and uses the existing tools.

### 6.1 Records

One record per issue event, so every act cites its own unchanging record:

| Record field | Value |
|---|---|
| `source` | `agent` |
| `externalId` | `linear:{issueId}:{historyEntryId}` |
| `threadExternalId` | `linear:{issueId}` (groups the events of one issue in inbox hints) |
| `sourceLabel` | `{identifier} {issue title}`, for example "PG-118 Dynamics CRM sync job" (200 characters at most) |
| `title` | the same as `sourceLabel` |
| `bodyText` | one line per change in the event, for example "State: In Progress → In Review", "Assignee: Quang Nguyễn", "Due date: 2026-10-13", then the comment text if the event is a comment |
| `occurredAt` | the event time |
| `author` | the person who made the change |
| `permalink` | the issue URL on `https://linear.app/...` |

### 6.2 Acts

| Linear event | Act on the ticket loop | Actor |
|---|---|---|
| Issue created and assigned by the requester | `request` | creator |
| Assignee moves it to In Progress, or sets a due date | `promise` (with `due` from the due date) | assignee |
| Due date changes after the promise | `renegotiate` | assignee |
| State moves to In Review | `report_done` | assignee |
| State moves to Done by the requester or reviewer | `accept` | reviewer |
| State moves back from In Review to In Progress | `reject` | reviewer |
| State moves to Canceled | `cancel` | the person who cancels |
| A comment that asks for status | `follow_up` | commenter |

The quote is the exact line in `bodyText` that shows the change, so the citation stays verifiable.

### 6.3 Proposal

The agent proposes, in one `update_proposal` batch (100 operations at most; the parent must exist in the snapshot or come earlier in the batch):

1. `put` of each ticket loop: `title` = "{identifier} {issue title}", `performer` = assignee, `customer` = requester, `performerDepartmentId` = the assignee's department, `milestoneId: null`, `parentLoopId` = the promise loop.
2. `put` of each act from 6.2.
3. Record decisions `included` for each cited record.

A human reviews and merges as usual.

## 7. Demo data

The story gets five tickets under the `go-live` loop (performer Minh Trần, Implementation). Linear team key: `PG`. T = 9 October 2026, 18:00.

| Ticket | Performer | Story | Expected state at T | Breakdown |
|---|---|---|---|---|
| PG-112 Fund III data import | Quang Nguyễn (Engineering) | request, promise, report_done, accept | closed | none |
| PG-113 Investor portal branding | Lan Phạm (Digitization) | request, promise, report_done, accept | closed | none |
| PG-117 Capital call notice template | Lan Phạm (Digitization) | request, promise, report_done, accept | closed | none |
| PG-118 Dynamics CRM sync job | Quang Nguyễn (Engineering) | request, promise due 13 October | promised | none |
| PG-121 Go-live checklist automation | Quang Nguyễn (Engineering) | request, promise due 7 October, no report | promised | `silent_overdue` |

- Every ticket record is cited and included, so the pending count stays 4.
- The gold expectations come from the engine rules. If the engine output differs from this table, the story changes, not the engine.
- Fixture permalinks change to real domains with fictional workspaces, so the demo shows app icons and links:
  - Slack: `https://fundline-larkspur.slack.com/archives/...` (was `fundline-larkspur.slack.example`). The declutter merge into PR #1 makes this change.
  - Gmail: `https://mail.google.com/mail/u/0/#all/{externalId slug}`. Today Gmail records have no permalink.
  - Linear: `https://linear.app/fundline/issue/{identifier}/{slug}`.
  - A click opens the real app's sign-in page or "not found", because the workspaces are fictional.
- The loop count goes from 30 to 35. Tests and the fixture README that state 30 change to 35. The eval stays at 100 %, with larger totals.

## 8. Error handling

- A ticket whose parent is missing, is a ticket, or is itself: validation error on update and merge, conflict on rebase and revert (3.2).
- A ticket with a milestone: validation error with the message in 3.2.
- A parent with tickets is removed: each ticket reports a missing parent.
- A ticket's parent is filtered out of the graph: the ticket is hidden with it (4.2).
- An old snapshot without `parentLoopId`: reads, hashes and diffs as before.

## 9. Tests

Unit:

- `referenceErrors`: each rule in 3.2, and a valid parent and ticket pair.
- `diffSnapshots`: a loop without the key and the same loop read back compare equal; setting `parentLoopId` gives one change.
- Rebase: a proposal that adds a ticket and a main that removes the parent give a conflict on the ticket. Revert uses the same `threeWayRebase` through `inverseCommit`, so this test also covers a revert that leaves a ticket without its parent.
- Layout: a collapsed parent hides tickets; an expanded parent places tickets in the following rows of its lane, with `forkY` = parent y; the block does not overlap the next block in the row; the chip room is reserved; navigation order; a ticket of a filtered-out parent is hidden.
- `applyLayoutOffsets`: a parent shift moves the ticket `forkY` and paths.
- Ticket progress: `done`, `total`, `broken`, `warning` from engine loops.

Integration:

- `updateProposal` accepts a valid ticket and rejects each broken rule with its message.
- Seed: the derived loops equal gold, including the five tickets; pending stays 4.

Fixtures and eval:

- 35 loops; eval at 100 %.

End to end:

- The go-live branch shows a chip "▸ 3/5" with a red dot; a click shows five ticket branches; another click hides them.
- The loop panel of go-live lists five tickets with Linear icons and "Open in Linear" links; "Show tickets on graph" expands them; a click on PG-121 opens its panel with "Part of Go-live date".
- The list view shows the tickets under go-live, indented.
- A department filter for Engineering keeps go-live visible because its tickets match.

## 10. Delivery

1. Branch `phucluu/linear-tickets` from `phucluu/promise-graph` after the declutter merge forward.
2. Commit per task with tests first. Run all gates, including end-to-end tests and the eval.
3. Show the owner on a local server.
4. Open PR "9/9 Linear tickets as child loops" with base `phucluu/promise-graph`, after the owner says yes.
