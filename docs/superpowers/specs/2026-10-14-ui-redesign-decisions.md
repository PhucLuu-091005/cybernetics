# UI Redesign Decisions

Date: 14 October 2026. Status: approved by the owner ("go", 14 October 2026). This record is the source of truth for the redesign. Where it differs from the graph declutter design or the Linear tickets design, this record wins; those two documents stay for their detail and history.

## Delivery

| PR | Scope | Base |
|---|---|---|
| A | Cursor theme for the whole app | `main` |
| B | Graph canvas: zoom, frozen axis and lane column, controls, % menu, minimap, full screen, zoom to a loop | A |
| C | Events: bare type icons, event cards with quotes, message sources, drag inside day and lane | B |
| D | Tickets and handoffs: child loops, `after` links, gateways, Anduin-style demo data | C |
| E | Time axis: day columns only, resizable per day, weeks and months reserved in a menu | D |

PRs #1–#8 merged into `main` on 14 October 2026 before this work started.

## A. Theme

- Cursor direction: neutral greys, black (light) or white (dark) primary actions, generous white space.
- Fonts: Geist and Geist Mono (Google Fonts, Vietnamese subset). Quotes and record text use Geist too; the serif font goes away.
- Mode: system by default, with the existing toggle.
- Radii: 6–8 px on controls, 10–12 px on cards. Segmented controls are a grey track with a raised white thumb.
- The active sidebar item has a filled background and bold text, no edge bar.
- Mockup: `docs/design/2026-10-14-theme-options.html` (Cursor).

## B. Canvas

As in the graph declutter design, section 4, with these settings:

- Geometric zoom 10 %–400 % (Miro). Wheel scrolls, Shift + wheel scrolls sideways, Ctrl/Cmd + wheel or pinch zooms around the pointer, drag on empty canvas moves it. No keyboard shortcuts.
- Floating controls: −, % (menu: Fit the project, Fit this week, Fit this month, 50 %, 100 %, 200 %), +, Fit, Minimap, Full screen.
- Frozen time axis on top and frozen lane column on the left.
- Double-click a branch: zoom to that loop, at most 150 %.
- First view: 100 %, T at 80 % of the width, trunk centred.
- Mockup: `docs/design/2026-10-14-graph-canvas.html`.

## B2. Time axis (owner decision, 15 October 2026)

- The axis shows day columns only, at every zoom. A day is 64 px wide at 100 %, so each day gets its "22 Sept" label; at low zoom the axis labels only the days that fit and hides the borders of days narrower than 12 px.
- A menu in the corner above the department column holds the axis scale: Days (on), Weeks and Months (shown, disabled, marked "not implemented yet").
- Each day column has a resize handle on its right edge: drag to resize (24–480 px at 100 %), double-click to reset that day. Widths stay in browser storage per project; "Reset column widths" in the menu clears them.
- A resized day widens or narrows everything drawn on that day; cards keep their size.

## C. Events

- **Marker on the line:** a bare type icon (18 px, Lucide shapes) with a small surface halo, in the loop tone (reject in red). Types: request = question bubble, promise = handshake, report done = parcel, accept = double check, reject = cross, counter / renegotiate / agree to change = calendar clock, follow-up = bell, decline / cancel = ban.
- **Event card:** above the branch line, with a stem to the exact time (layout of option C). Cards that would overlap go to the next shelf up. Card style of option D: tinted fill in the loop tone, bold act type and date, the person, the **quote** (two lines at most), then the source app icon, source label and link. Card size 176 × 108 layout px.
- Cards replace the act labels, the source labels and the hover card. The full quote is in the card's `title` and in the loop panel.
- Cards show at zoom 45 % or more; below that only the markers show.
- Each branch reserves its card shelves above its line in the layout, so cards never cover another row.
- **Sources and links:** the graph view returns `sources`; the app picks the source app from the permalink domain (`slack.com`, `mail.google.com`, `linear.app`) and only those domains are clickable. Icons: Slack `#`, Gmail mark, Linear mark, clipboard (paste), robot (agent).
- **Drag:** drag a card or its marker. The dot stays inside its local day; the branch moves up or down inside its lane. Positions are saved in the browser per project, with "Reset layout".
- Mockups: `docs/design/2026-10-14-event-styles.html` (C and D), `docs/design/2026-10-14-theme-options.html` (quote, bare icon).

## D. Tickets and handoffs

- **Data:** `Loop.parentLoopId` (one level) and `Loop.afterLoopIds` (siblings that must close before this loop starts; the agent fills it from Linear "blocked by"). A top-level loop carries neither key. Rules: the parent exists and is top level; a child has no milestone; `after` names siblings of the same parent; no cycles; no self-reference.
- **Lanes:** every child sits in the lane of its own performer department. No lane exception.
- **Gateways** (diamond with an icon, label above):
  - Split, on the parent line: work leaves the promise owner (children with no `after`).
  - Handoff, at the end of a child that has successors: connectors go straight to the successors' lanes. The line does not return to the promise.
  - Join, before a child with two or more predecessors: it waits for all of them.
  - Return, on the parent line: a child with no successors closes and the work comes back to the promise owner.
- **Waiting:** a caution segment from a handoff or join to the successor's start when the gap is over one business day, labelled "waited N business days" (or "waiting for PG-203" while a predecessor is open).
- **Early start:** a warning marker "started before handoff" when a successor's first act comes before all its predecessors closed. Display only; the engine and its breakdown types do not change.
- **Parent chip:** "N tasks · K done".
- **Panel and list:** the parent panel lists its tasks by department with source links; a task panel shows "Part of {parent}" and "After {predecessors}"; the list view indents tasks under their parent. The loop editor edits the parent and the `after` list.
- **Agent recipe:** Linear issues become per-event records; acts follow the state changes; "blocked by" becomes `afterLoopIds`.
- Mockups: `docs/design/2026-10-14-anduin-flow.html`, `docs/design/2026-10-14-junctions.html` (option A), `docs/design/2026-10-14-handoff-explainer.html`.

## Demo data (Anduin-style onboarding, fictional vendor Fundline)

Modelled on Anduin's public description of fund onboarding (Engage → Digitize → Launch) and its job descriptions. Names stay fictional.

- Vendor departments: Implementation, Digitization, **Digitization QA** (new), **Solutions Engineering** (new), Engineering, Customer Success. Existing names stay, because department IDs come from their names.
- Client: Fund Operations, Legal (fund counsel), IT.
- New scenario: the GP asks for a CRS tax-residency section in the Fund III subscription form with a DealCloud sync. Implementation promises it; Digitization analyses it; Digitization hands off to Solutions Engineering (form logic, DealCloud mapping) and Engineering (country-list field type); Digitization QA waits for all three; QA returns to Implementation. One ticket is overdue, so QA shows "waiting for" it.
- Demo permalinks use real domains with fictional workspaces (`fundline-larkspur.slack.com`, `mail.google.com`, `linear.app/fundline`).
