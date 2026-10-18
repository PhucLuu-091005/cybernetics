# Simpler Screens Design

Date: 15 October 2026. Status: draft for owner review. Option B ("three jobs") from the 15 October session, plus a collapsible sidebar. Mockup: `docs/design/2026-10-15-simplify-ui.html`.

## 1. Goal

The owner said the app is hard to use and has too many features. A person must be able to do three jobs without knowing git words:

1. **Look**: read the graph and find the problems.
2. **Review**: decide on new records and on change sets from people and agents.
3. **Answer**: work on an escalation.

Success: a new user reaches each job from the sidebar in one click, and no screen shows a commit id, a revision number or a hash unless the user opens "Technical details".

## 2. Constraints

- The core stays: evidence records, acts with exact quotes, loops, the engine and its 7 breakdown types, agent proposals through MCP, a human merge, history with revert and restore.
- No change to the REST API, the MCP tools, the contracts, the database, the engine or the fixtures. Agents need no change. The agent recipe keeps the API names.
- Merge keeps every server check (expected main, proposal revision, evidence revision, review digest).
- Deadline: 18 October 2026 23:59 HCMC. Work starts on top of PR #13 (`phucluu/day-columns`).
- Commit locally and run the app. Push only after the owner checks. No AI attribution trailer in commits.

## 3. Words on screen

Only UI text changes. API, MCP and docs for agents keep the old names.

| Today | After |
|---|---|
| Main, read-only | Approved graph |
| Proposal, draft | Change set, open |
| Merge into main | Approve |
| Close (a proposal) | Reject |
| Commit, head commit `3f9c2a1` | Version; "Last change {time} by {person}" |
| History | Activity |
| Revert | Undo this change |
| Restore | Go back to this version |
| Rebase; "stale, rebase needed" | Update to latest; "Needs update" |
| Evidence revision; "Acknowledge evidence revision N" | Hidden; "New records arrived. Refresh." |
| Evaluate at (T) | As of |
| Breakdown | Problem (filter label "Problem type") |
| Include in proposal / Ignore in proposal | Select a quote to add an act / Ignore |
| Commit message field | Hidden; the app sends the change set title |
| Review basis card | "Technical details", closed by default |

The rail footer note becomes "Nothing changes the graph until a person approves it."

## 4. Sidebar

### 4.1 Content

- The rail shows the current project only. A project switcher at the top lists every project of the user (avatar letter, client name, project title).
- Main items: **Graph**, **Review** (count = open change sets + pending records), **Escalations**.
- Footer items: **Settings** (opens the agent tokens page), theme toggle, sign out, collapse button.
- Inbox, Proposals, History and Agent tokens leave the rail.

### 4.2 Collapse

- Open width 212 px. Folded width 56 px: icons only, a tooltip with the label on hover and focus, and a violet dot on Review when its count is above 0.
- The collapse button is the last footer item. Label: "Collapse sidebar" or "Expand sidebar"; it carries `aria-expanded`.
- The state lives in a cookie `pg_rail` (`open` or `collapsed`, `Path=/`, one year, `SameSite=Lax`). The server layout reads it and renders the right width, so the page does not jump on load. The toggle writes the cookie and flips the attribute without a reload.
- Each item keeps an `aria-label`, so a folded rail stays usable with a screen reader and the keyboard.
- At 760 px or less the rail stays the current top bar and the collapse button is hidden.

### 4.3 Structure

`(app)/layout.tsx` keeps the auth check. A new `(app)/projects/[id]/layout.tsx` renders the rail, because it knows the project id and can read the Review count. The home page keeps its current behaviour.

## 5. Graph screen

### 5.1 Header

- Remove: the keyboard hint line, the head commit id, the evidence revision and the "Create proposal" button. Keyboard navigation itself stays.
- Show: the project title and time zone; the "Approved graph" badge; "Last change {time} by {person} · Activity" (link to `/history`); the pending pill "N new records to review" (link to Review, records tab); "As of" with its reset.

### 5.2 Filters

- Visible: search, a **Problems only** toggle (it shows loops with at least one breakdown; no count, because the count needs a change in a file the graph-polish session owns), a **Filter** button, the Graph/List switch.
- The Filter button opens a popover with Side, Departments, State, Problem type and Milestone, plus "Clear". The button shows the number of active filters.
- `GraphFilters` gets `problems: boolean`, URL parameter `problems=1`. It keeps loops with one or more breakdowns at the current T. It combines with the other filters.

### 5.3 Canvas

- Controls: −, the zoom percentage as plain text, +, Reset layout (only after a drag), Fit, Full screen.
- Remove: the zoom preset menu, the minimap, the axis menu (Days, disabled Weeks and Months, "Reset column widths") and the day column resize handles with their browser storage. A day without events is 64 px at 100 %; a day with events widens to fit them. The day labels from PR #13 stay.
- Wheel, pinch, drag, double-click zoom, event cards and card drag stay.

## 6. Review screen

New route `/projects/[id]/review`. It replaces Inbox and Proposals in the rail.

### 6.1 Layout

- Header: "Review", the project, a **New change set** button (opens the existing create form in a popover).
- Left: two tabs, **Change sets** (open drafts, newest first) and **New records** (pending records, newest first), each with a count. The default tab is Change sets when one exists, else New records.
- Right: the selected item. URL: `?tab=sets|records&item=<proposalId>` or `&r=<recordVersionId>`.
- List footer: "Approved change sets are in Activity." On the records tab, a link "All records" opens the old inbox page with every state.

### 6.2 Change set states

| State | Condition | List badge | Detail |
|---|---|---|---|
| Ready | base = main and evidence revision = current | Ready | Approve is on |
| New records arrived | evidence revision moved | Needs refresh | Banner with **Refresh** (the existing zero-operation update) |
| Needs update | base ≠ main, rebase preview has no conflict | Needs update | Banner with **Update to latest** |
| Conflict | base ≠ main, rebase preview has a conflict | Needs update in the list, Conflict in the detail | Banner with **Resolve conflict** (opens the existing rebase page, heading "Resolve conflict") |

The list computes only the cheap states. The detail runs the rebase preview for the selected change set only.

### 6.3 Change set detail

- Title, author (agent badge for an MCP author), rationale.
- Actions: **View on graph** (graph with `?proposal=`), **Edit** (existing proposal workspace), **Reject** (existing close endpoint), **Approve**.
- **What changes**: the existing diff, in plain sentences.
- **Effect on the loops**: the existing effects table.
- **Quotes**: the cited quotes with source, person and time.
- A note when records are still pending: "N new records are not reviewed yet. You can approve this change set before them." No checkbox.
- **Technical details** (closed): base version, change set revision, evidence revision, evaluated at, snapshot hash, review digest.
- Approve calls the existing merge endpoint with the review basis and `message` = the change set title. On success the screen selects the next item and shows "Approved: {title}. View on graph."
- **Update to latest** calls the rebase preview, then the rebase apply with the same expectations, the preview digest and an empty resolution list. Then the screen reloads the change set and shows "Updated. Check the changes again, then approve." The digest changes, so the user must look at the new diff before Approve, as today.

### 6.4 New record detail

- The record text with the existing quote selection ("Select a quote to add an act").
- **Ignore** with a reason.
- Target change set: the newest open change set that the viewer authored and titled "My review". The first decision creates it from the approved graph. The "Review in" draft picker goes away.
- Note: "Your decisions go into your change set 'My review'. The graph changes when you approve it."

### 6.5 Old routes

- `/projects/[id]/proposals` redirects to Review, Change sets tab.
- `/projects/[id]/inbox` stays as "All records", out of the rail.
- `/proposals/[proposalId]` (editor), `/review` and `/rebase` stay. The editor and the rebase page get the new words. The old review page redirects to Review with the item selected.
- `/history` and `/history/[commitId]` stay, with the heading "Activity" and the new words.

## 7. Other screens

- Escalations: new words only.
- Settings (agent tokens): heading "Settings", section "Agent access". Content unchanged.

## 8. Out of scope

Engine, API, MCP, database, fixtures, loop panel content, event cards, escalation logic, a weeks or months axis, keyboard shortcuts for the rail.

## 9. Testing

- Unit: the `problems` filter and its URL parameter; the `pg_rail` cookie parser; the change set state function (Ready, Needs refresh, Needs update, Conflict).
- Component: the rail renders labels when open and only icons with `aria-label` when folded.
- End to end (Playwright): update the specs that use old labels ("Merge into main", "Create proposal", Inbox, Proposals). New specs:
  - fold the rail, reload, the rail stays folded;
  - approve the seeded agent change set from Review and see the act on the graph;
  - approve one competing title change set, then see "Needs update" on the other and reach "Resolve conflict";
  - ignore the out-of-office record from New records and see it in "My review".
- Gates: typecheck, lint, unit and integration tests, e2e, build, all in a separate worktree.

## 10. Delivery

One PR "F · Simpler screens" on top of #13, in commits per area: words, sidebar, graph header and filters, canvas cuts, Review screen, old routes, docs and screenshots. README screenshots and the "Connect an agent" step ("Open Settings") change with it.
