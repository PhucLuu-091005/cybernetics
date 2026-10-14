# Graph Declutter Design

Date: 14 October 2026. Status: draft for owner review. Target: PR #7 (`phucluu/pg-06`, "6/8 UI: graph screen, loop panel and inbox"), then merge forward into PR #8 (`phucluu/pg-07`) and PR #1 (`phucluu/promise-graph`).

Visual references: [sidebar, icons and labels mockup](../../design/2026-10-14-graph-declutter.html), [canvas panel mockup](../../design/2026-10-14-graph-canvas.html).

## 1. Owner feedback and agreed answers

The owner reviewed the graph screen of PR #7 on 14 October 2026 and asked for these changes, in three rounds.

| # | Feedback | Agreed answer |
|---|---|---|
| 1 | The dark bar on the left edge of the active sidebar item looks machine-made. | Remove the bar. Mark the active item with a filled background and bold text only. |
| 2 | Branches and events touch each other, so the graph is hard to read. Let users drag them, but each item must stay inside its day. | The user drags one event dot. A horizontal drag moves the dot inside its local calendar day. A vertical drag moves the whole branch up or down inside its department lane. |
| 3 | Each event must show where the message came from, with a link to it. Use app icons, not app names. | At 80 % zoom or more: an app icon and the source label next to each dot, as a link. At every zoom: icon, source and link in the hover card. The card stays open when the pointer moves into it. The app comes from the permalink domain; links to Slack, Gmail and Linear are clickable. |
| 4 | The department column must stay in place during a horizontal pan. | The lane names become a frozen column left of the canvas. The dates become a frozen row above it. |
| 5 | How does the board show a feature or promise that becomes developer tickets? | The board does not show it now. See section 7 and the Linear tickets design. |
| 6 | The graph is too small. Make it a panel with zoom in and out, full screen and drag, as in Miro or draw.io. Make events bigger. Hover shows a brief. | A canvas panel (section 4): geometric zoom as in Miro, scroll to move and Ctrl/Cmd + scroll or pinch to zoom, floating controls with a % menu, fit, minimap and full screen, double-click to zoom to a loop, 28 px events, a brief hover card. |

Dragged positions are saved in the browser (`localStorage`), per project. They change the display only. They never change a date, an act, a loop or the graph snapshot.

## 2. Scope

In scope:

- The sidebar style and the inbox record list style (the same bar appears in both places).
- Drag of event dots, with day and lane limits, browser storage and a reset action.
- Source label, source link and an interactive hover card.
- A canvas panel: viewport, frozen axis and lane column, controls, % menu, minimap, full screen, zoom to a loop, level of detail and bigger events.

Out of scope:

- Developer tickets, sub-loops and ticket-system sources (section 7).
- Keyboard drag. Keyboard users keep Tab navigation, Enter to open and the list view.
- Shared or per-account layout storage on the server.
- Changes to the automatic row packing. Section 8 lists one optional change for the owner to decide.
- Keyboard shortcuts for the canvas. The owner did not choose them. The controls are buttons, so keyboard users reach them with Tab.
- Saving the viewport or the minimap state between visits.

## 3. Sidebar and inbox active state

Files: `src/app/globals.css`.

- `.nav a[aria-current='page']`: remove `box-shadow: inset 3px 0 0 var(--ink)`. Keep `background: var(--surface)` and `color: var(--ink)`. Add `font-weight: 700`.
- `.ritem[aria-current='true']`: remove the same inset shadow. Keep `border-color: var(--ink)`.
- PR #8 and PR #1 add more screens. During the merge forward, remove every other `inset 3px 0 0` accent bar that those branches add.

## 4. Canvas panel

Owner decisions of 14 October 2026: geometric zoom as in Miro; the wheel scrolls and Ctrl/Cmd + wheel or pinch zooms, as in Figma, FigJam and draw.io; a minimap; a % menu with presets; double-click to zoom to a loop. The owner did not choose keyboard shortcuts.

Files: `PromiseGraph.tsx`, `GraphScreen.tsx`, `FilterBar.tsx`, `LaneLabel.tsx`, `Legend.tsx`, new `LaneColumn.tsx`, `TimeAxis.tsx`, `CanvasControls.tsx`, `Minimap.tsx`, `src/lib/graph-layout/viewport.ts`, `globals.css`.

### 4.1 Structure and size

- The stage has four parts: a frozen corner (120 × 28 px, "Departments"), a frozen time axis on top (28 px), a frozen lane column on the left (120 px), and the canvas in the rest.
- The stage fills the screen height below the graph header: `height: calc(100dvh - var(--graph-top))` with a minimum of 480 px. The page does not scroll inside the graph area.
- The legend moves into the stage, as a small floating row at the bottom left.
- When the loop panel is open, it takes 400 px on the right of the stage, as today. Full screen (4.6) includes it.

### 4.2 Layout scale and viewport

- The layout is computed once per data change at a fixed base scale: 18 px per day, row height 64 px, act node 28 px (was 22 px), hit circle radius 14 px. Zoom does not run the layout again.
- The base scale replaces the "milestones", "branches" and "detail" zoom levels. `FilterBar` loses the zoom segmented control. `GRAPH_LEFT` becomes 0 inside the canvas, because the lane column is outside it.
- The viewport is React Flow's `{ x, y, zoom }` with `minZoom: 0.1` and `maxZoom: 4`. Zoom scales everything: lines, dots, text and spacing.
- React Flow's `translateExtent` is the content box plus 400 layout px on each side, so the content cannot leave the screen.
- The graph group carries `data-zoom` (two decimals) and no longer `data-px-per-day`.
- First view: **100 %**, with T at 80 % of the canvas width and the trunk at the vertical centre. At the base scale a five-month window fits at about 40 %, where text is too small to read, and "Fit this month" across a 1,100 px canvas gives about 200 %, where text is large. One click on "Fit the project" shows the whole window. This changes SRD 7.2 ("the default view fits the project window to the screen width"); the plan updates the SRD.

### 4.3 Pointer, wheel and touch

| Input | Result |
|---|---|
| Wheel | Moves the canvas up and down |
| Shift + wheel | Moves the canvas sideways |
| Two-finger trackpad slide | Moves the canvas in both directions |
| Ctrl/Cmd + wheel, trackpad pinch | Zooms around the pointer |
| Drag on empty canvas | Moves the canvas |
| Drag on a dot | Moves the dot (section 5) |
| Double-click on a branch | Zooms to that loop (4.7) |
| Touch: one-finger drag on empty canvas | Moves the canvas |
| Touch: two-finger pinch | Zooms |

React Flow settings: `panOnScroll`, `panOnScrollMode: 'free'`, `zoomOnScroll: false`, `zoomOnPinch: true`, `zoomActivationKeyCode: ['Meta', 'Control']`, `panOnDrag: true`, `preventScrolling: true`, `zoomOnDoubleClick: false`. The custom wheel and pinch handlers in `PromiseGraph` go away.

### 4.4 Controls and % menu

A floating toolbar at the bottom right, with `role="toolbar"` and the name "Canvas controls":

| Button | Action |
|---|---|
| − | The next lower step of 10, 25, 50, 75, 100, 125, 150, 200, 300, 400 % |
| `{n}%` | Opens the % menu |
| + | The next higher step |
| Fit | Fit the project |
| Minimap | Shows or hides the minimap (`aria-pressed`) |
| Full screen | Enters or exits full screen |

The % menu (`role="menu"`) has: "Fit the project" (the whole content box, 32 px padding), "Fit this week" (T − 4 days to T + 3 days) and "Fit this month" (T − 25 days to T + 5 days), then "50%", "100%" and "200%". The week and month presets fit the date range across the canvas width and put the trunk at the vertical centre; a full-height fit would stop at about 40 % on a project with seven lanes. The menu closes on a choice, on Escape and on a click outside.

### 4.5 Minimap

- 220 × 120 px, above the controls at the bottom right. Hidden at first.
- It draws the lane stripes, the trunk and each branch line in its tone, scaled to fit. A blue box shows the visible area.
- A click or a drag in the minimap centres the canvas on that point.
- It uses the layout data, not React Flow's `MiniMap`, because the branches are edges and React Flow's minimap draws only nodes.

### 4.6 Full screen

- The button calls `requestFullscreen()` on the stage grid that holds the graph and the loop panel. Escape exits, as the browser does.
- The button label and icon change to "Exit full screen". A `fullscreenchange` listener keeps them in step.
- Where `document.fullscreenEnabled` is false (iPhone Safari), the button is hidden.

### 4.7 Zoom to a loop

A double-click on a branch fits that loop's box (from the fork start to the merge end or T, from the branch line to the trunk) with 48 px padding and at most 150 %, so its text stays at a normal reading size. The loop panel does not open on a double-click; a single click still opens it.

### 4.8 Frozen time axis

- It draws ticks from the viewport: a day is `18 × zoom` px on screen. With 56 px or more per day it labels every day; with 8 px or more it labels each week; with less it labels months only. The first day of a month has a full-height tick and a bold month name.
- It shows the T marker ("T 9 Oct") above the T line.

### 4.9 Frozen lane column

- Each lane name sits at screen y = `viewport.y + lane.y × zoom`, with height `lane.height × zoom`, with the same stripes as the canvas.
- A name is hidden when its band is under 14 px.
- "Vendor ↑ · Client ↓" sits at the trunk.
- The column takes pointer events, so hidden canvas parts under it cannot be clicked.

### 4.10 Level of detail

| Zoom | Shows |
|---|---|
| under 60 % | dots, lines, breakdown markers, milestones (no text) |
| 60 % or more | also branch titles and milestone names |
| 80 % or more | also act labels and source labels (section 6.3) |

### 4.11 Keyboard and reveal

- Tab still walks milestones, then branches. A focused branch or milestone that is off screen comes into view with `setCenter` at the current zoom.
- Opening a loop from the list view or the panel centres its branch.

## 5. Drag of event dots

### 5.1 Behaviour

- Drag starts on an event dot (the 14 px hit circle in `BranchEdge`) after the pointer moves 4 screen px. A shorter press stays a click and selects the loop and act, as today.
- During the drag, the hover card closes and the cursor is `grabbing`. On hover, the cursor over a dot is `grab`.
- Horizontal movement moves only the dragged dot. The dot stays inside its local calendar day in the project time zone. At the left edge the dot sits at day start. At the right edge it sits 0.5 px before the next day.
- Pointer movement is in screen px. The drag divides it by the zoom to get layout px, so a dot follows the pointer at every zoom.
- Vertical movement moves the whole branch: its fork curve, its line, its glyphs, its breakdown markers and its merge curve. The branch line stays inside its department lane, at least `rowHeight / 2` (32 layout px) from the lane top and bottom.
- If a dot moves left of the branch start, the branch start follows it. If a dot moves right of the branch end, the branch end follows it. The line never gets shorter. Segment tones stay where the layout put them. A dot moves inside one day, so a tone boundary is off by less than one day.
- Escape during a drag cancels it and restores the previous position.
- Release saves the position.
- Drag works at every zoom. A day is 18 layout px, so at 100 % a dot can move 18 screen px sideways, and at 200 % 36 px.
- Drag works on main, on a proposal and on a commit view. Act and loop IDs are stable across views, so the same positions apply.
- A drag never pans the graph. The dot hit circle carries the React Flow `nopan` class, and the pointer handlers stop propagation.

### 5.2 Data

```ts
// src/lib/graph-layout/offsets.ts
export type LayoutOffsets = {
  /** Position of the dot inside its local day: 0 = day start, 1 = day end. */
  acts: Record<string, number>;
  /** Vertical shift of the branch line in px. Positive moves down. */
  loops: Record<string, number>;
};
export function applyLayoutOffsets(
  layout: GraphLayout,
  offsets: LayoutOffsets,
  rowHeight: number, // the same value that produced the layout (64 at the base scale)
): GraphLayout;
```

- The layout engine adds `dayStartX` and `dayEndX` to each `ActGlyph` (contract change in `src/contracts/layout.ts`). The values come from the time scale for the local day that contains `occurredAt`.
- `applyLayoutOffsets` is pure. It returns a new layout. It clamps every act fraction to `[0, 1]` and every loop shift to the lane limits. It rebuilds the branch `path` from the new `y`, `xStart` and `xEnd` with the same curve geometry as `layoutPromiseGraph`. It ignores IDs that are not in the layout.
- `GraphScreen` keeps the base layout in its existing `useMemo`. A second `useMemo` applies the offsets. A pointer move updates the offsets state only, so a drag does not run the full layout.
- Offsets are in layout units. Zoom never runs the layout again, so they stay correct at every zoom.

### 5.3 Storage and reset

- Key: `promise-graph:layout:v1:{projectId}`. Value: JSON `LayoutOffsets`.
- The store validates the value with Zod. A missing, invalid or unreadable value gives empty offsets. Every read and write is in `try/catch`, so a private window or a blocked storage still renders the graph.
- The graph toolbar shows a "Reset layout" button when the project has saved offsets. The button clears the key and the state.
- The store keeps at most 3,000 act entries and 300 loop entries, the snapshot caps. A write that exceeds them drops the oldest entries first.

## 6. Message source and link on each event

### 6.1 Data

- `GraphViewSchema` (`src/contracts/views.ts`) gets a new field:

  ```ts
  sources: z.record(IdSchema, z.strictObject({
    source: SourceKindSchema,
    sourceLabel: z.string().min(1).max(200),
    permalink: PermalinkSchema.nullable(),
  }))
  ```

  The key is the cited `recordVersionId`.
- `getGraphView` fills it with the existing `loadCitationSources` for every cited record version in the snapshot (1,000 at most, the snapshot cap).
- `permalink` is the stored permalink, or `null` for withdrawn evidence (the rule of `loadCitationSources`). The browser decides which links are active (6.2), with the same rule as the loop panel.
- The REST route `GET /api/v1/projects/:projectId/graph` returns the same `GraphView`, so it also gets `sources`. The change only adds a field. MCP reads do not change.

### 6.2 Source app, icon and link target

Owner decision of 14 October 2026: the app recognises the source app from the permalink domain, and links to three known domains become clickable.

A new pure module `src/lib/source-app.ts` holds the rule. The graph, the loop panel and the record viewer all use it.

- `sourceApp(source, permalink)` returns `'slack' | 'gmail' | 'linear' | 'agent' | 'paste'`:
  - A native `slack` or `gmail` source gives that app.
  - Otherwise the `https://` permalink host decides: `slack.com` or a subdomain of it gives `slack`; `mail.google.com` gives `gmail`; `linear.app` gives `linear`.
  - Otherwise the source kind decides: `agent` or `paste`.
- `linkablePermalink(source, permalink)` returns the permalink when it is `https://` and its app (by the rule above) is `slack`, `gmail` or `linear`. It returns `null` for every other permalink, which stays plain text.
- This replaces the PR #1 rule "an agent or pasted permalink is never a link" (commit `4ee9cc0`). The merge forward into PR #1 changes `activePermalink` in `src/components/inbox/links.ts` to call `linkablePermalink`, and updates `docs/mcp-agent-recipe.md`.

Icons (`src/components/graph/SourceIcon.tsx`), one colour (`currentColor`), with the app name as `<title>`:

| App | Icon | Origin |
|---|---|---|
| Slack | `#` (hash) | Lucide `hash`, ISC. Simple Icons removed the Slack logo at Slack's request, so the design uses the channel sign. |
| Gmail | Gmail mark | Simple Icons 16.32.0 `gmail`, CC0 |
| Linear | Linear mark | Simple Icons 16.32.0 `linear`, CC0 |
| Paste | clipboard | Lucide `clipboard-paste`, ISC |
| Agent | robot | Lucide `bot`, ISC |

`sourceLink(projectId, recordVersionId, source)` in `src/components/graph/source-link.ts` picks the target:

- Linkable permalink: "Open in Slack", "Open in Gmail" or "Open in Linear". The link opens a new tab with `rel="noopener noreferrer"`.
- No linkable permalink: "View record". The link opens `/projects/{projectId}/records/{recordVersionId}` in the same tab.

### 6.3 Labels at 80 % zoom or more

- Rows are 64 layout px (4.2): a source label line and an act label line above each branch line, and the branch title below it, without a touch on the next row. The canvas mockup checked this at 73 % and 150 %.
- The labels show at 80 % zoom or more (4.10). Room is in layout px, so a label that has no room stays hidden at any zoom; a user can drag the dot within its day to make room.
- Above each dot, the act label ("promise MT") stays at `y - 10`. It moves from `ActNode` into `BranchEdge`, so it can use the same room rule as the source label.
- A source label sits at `y - 24`: the app icon (12 px), then `sourceLabel`, then an arrow for an external link. Example: `[#] #larkspur-onboarding ↗`.
- The source label is an SVG `<a>` inside `BranchEdge`, so it takes clicks. It has `tabIndex={-1}`, so Tab keeps its order (milestones, then branches). Keyboard users reach the same links in the loop panel.
- Room is the distance to the next glyph on the same branch, minus 6 px. For the last glyph, room is 160 px.
  - Source label: 90 px or more gives the icon and `sourceLabel` (truncated with an ellipsis to fit); 24 px to 89 px gives the icon only; under 24 px gives no source label.
  - Act label: it shows only when its full text fits in the room (characters × 5.8 px). It is never truncated.
  - The hover card always shows everything.
- The `<a>` title and accessible name are `{App} · {sourceLabel}: {link text}`, for example "Slack · #larkspur-onboarding: Open in Slack".

### 6.4 Hover card (a brief of one event, at every zoom)

- The card anchors to the dot's screen box: 6 px right of and 6 px below its bottom-right corner, kept inside the stage. It does not follow the cursor.
- It shows, in this order: the loop title (small); act type, actor and local time with the time zone; the quote (140 characters at most); then the app icon with `sourceLabel` and the link from 6.2.
- The card stays open while the pointer is on the dot or on the card. It closes 200 ms after the pointer leaves both, so the user can move into the card and click the link.
- The card has `role="dialog"` with an accessible name, because it holds a link. Escape closes it.
- The card closes during a drag, a pan and a zoom.

## 7. Developer tickets (answer to question 5)

The owner chose to build ticket support with Linear as the first ticket source: [Linear tickets design](2026-10-14-linear-tickets-design.md). The text below records the state before that work.

The board has no ticket concept today.

- The data model has loops. One loop is one request, promise and delivery cycle between two parties. It sits in the lane of the performer's department and can link to one milestone.
- A loop has no parent loop and no child loops.
- Evidence sources are `paste`, `agent`, `slack` and `gmail`. No Jira, Linear or GitHub Issues source exists.
- Result: if a feature promise becomes five developer tickets, and each ticket has its own evidence, the board shows six separate loops. Only a shared milestone links them.

A ticket view needs at least:

1. A data model change: `Loop.parentLoopId` or a separate `workItems` list on a loop. This changes the snapshot schema, the diff, the rebase and the validation.
2. A layout change: child branches drawn inside or under the parent branch, with a collapsed and an expanded state.
3. A source for ticket evidence: a ticket-system import through the agent or REST path.

The Linear tickets design covers these three points.

## 8. Optional change for the owner to decide

Row packing (`packRows`) puts two branches in one row when the gap between their lines is 16 px or more. It does not count the fork and merge curves (16 px each side). Two short branches in one row can therefore touch. Counting the curves would remove most contact before any drag. The cost: more rows, taller lanes, and updated layout tests. This design does not include the change. The owner decides in the review.

## 9. Error handling

- Storage read or write fails: the graph renders with no offsets, and the drag still works for the session.
- Stored data has an old shape or unknown IDs: the store ignores it.
- `sources` lacks an entry for a cited version: the card and the label show no source line, and the link falls back to "View record". The server already returns an error when a cited version is missing, so this case is defensive only.
- The viewport changes during a drag (a pinch): the drag continues. Offsets are in layout units, so the dot stays in its day and the branch stays in its lane.
- The Fullscreen API is missing or refuses (iPhone Safari, an iframe without permission): the button is hidden, or the request fails silently and the stage stays in the page.
- Ctrl/Cmd + wheel inside the canvas must not zoom the browser page: React Flow's `preventScrolling` stops it. Outside the canvas, the browser zoom works as usual.

## 10. Tests

Unit (Vitest):

- `applyLayoutOffsets`: the act fraction clamps to the day; the loop shift clamps to the lane on the vendor side and on the client side, at row height 28 and 64; the first and last glyphs extend the branch start and end; the path rebuild matches `layoutPromiseGraph` with zero offsets; unknown IDs are ignored.
- Layout: `dayStartX` and `dayEndX` are correct across a DST change in a time zone that has one (for example `America/New_York`).
- Offset store: valid JSON round-trips; invalid JSON, a wrong version and a storage that throws give empty offsets; the caps hold.
- Viewport helpers (`src/lib/graph-layout/viewport.ts`): `fitViewport` for a box and a canvas size, with padding and a maximum zoom; the zoom steps (next and previous); the axis tick rule (days, weeks, months by px per day); the level of detail; the minimap mapping from a minimap point to a viewport.
- `sourceApp` and `linkablePermalink`: native Slack and Gmail sources; agent and paste records with `https://` permalinks on `x.slack.com`, `mail.google.com` and `linear.app`; look-alike hosts (`slack.com.evil.example`, `linear.app.example`, `mail.google.com.example`) and `http:` give no link and the `agent` or `paste` app.
- `sourceLink`: a linkable permalink gives an external link named after the app; anything else gives the in-app "View record" link.

Integration (Vitest against PostgreSQL):

- `getGraphView` returns `sources` for every cited version; withdrawn evidence keeps its source label and has a null permalink.

End to end (Playwright):

- Sidebar: the active item has no inset box shadow.
- Canvas: the first view is 100 %; Ctrl + wheel zooms (`data-zoom` grows); a pinch zooms; the wheel alone moves the canvas and keeps the zoom; a drag on empty canvas moves it; the − and + buttons step the zoom; the % menu applies "100%" and "Fit the project"; the minimap button shows the minimap, and a click in it moves the view; double-click on a branch zooms to at most 150 % with the branch on screen; the full screen button enters and exits full screen.
- Frozen parts: after a sideways move the lane names keep their x; after a vertical move and a zoom each lane name stays inside its lane band; the axis shows day labels at 400 % and only month names at 10 %.
- Level of detail: at 50 % no branch title shows; at 100 % titles and source labels show.
- Drag: a vertical drag moves the branch and stays inside the lane; at 200 % a horizontal drag stays inside the day (36 screen px at most); a reload keeps both positions; "Reset layout" clears them.
- A click on a dot still opens the loop panel on that act.
- Hover card: it shows the source line; the pointer can move into the card; the link has the correct target.
- At 100 %: a dot with 90 px of room has an icon and a source label link; a dot with less than 24 px of room has no label.

## 11. Delivery

1. Work on a branch from `phucluu/pg-06`. Commit per section with tests first.
2. Run all gates (typecheck, lint, format check, eval, unit and integration tests, build, end-to-end tests).
3. Fast-forward `phucluu/pg-06` (PR #7).
4. Merge `phucluu/pg-06` into `phucluu/pg-07` (PR #8), resolve conflicts, run all gates, push. Repeat for `phucluu/promise-graph` (PR #1).
   - On PR #1, the demo seed arrives through the agent path with Slack permalinks on `fundline-larkspur.slack.example`. The merge changes that domain to `fundline-larkspur.slack.com` (a fictional workspace on the real domain), so the demo shows the Slack icon and link. PR #1 also switches `activePermalink` to the shared rule and updates `docs/mcp-agent-recipe.md`.
5. Show the owner the result on a local server before any merge of PR #7.
