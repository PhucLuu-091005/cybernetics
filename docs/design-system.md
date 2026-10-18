# Design system

This file describes the visual language of the event tracker. The values come from the CSS in the repository. When this file and the CSS disagree, the CSS is right: fix this file in the same commit.

- Visual reference: [docs/design/design-system.html](design/design-system.html). Open it from the file system. It shows every token and component in light and dark.
- Sources: [src/app/globals.css](../src/app/globals.css) (base tokens and global components), [src/app/shell.css](../src/app/shell.css) (rail and project switcher), [src/components/tracker/tracker.css](../src/components/tracker/tracker.css) (tracker tokens, board, graph, pops, drawers, modals), [src/components/tracker/review.css](../src/components/tracker/review.css) (clash picks and the Before / After switch of the change request page), [src/components/tracker/icons.tsx](../src/components/tracker/icons.tsx) (icons), [src/tracker/layout.ts](../src/tracker/layout.ts) (graph geometry and status tones).
- Direction: D2 Radix calm, chosen by the owner on 17 October 2026, drawn flat with few cards. The option page is [docs/design/2026-10-17-design-directions.html](design/2026-10-17-design-directions.html).
- Behaviour rules of the graph come from the spec: [docs/superpowers/specs/2026-10-16-event-tracker-design.md](superpowers/specs/2026-10-16-event-tracker-design.md), decisions 2, 3, 5, 8 and section 3.8.

## 1. Principles

1. **Modern, quiet, flat.** The app must feel like Linear or Cursor: calm grey surfaces, one ink colour for text, colour only where it carries meaning.
2. **Few cards.** The rail, the Queue, the lists in drawers, the history and the review lists use bold text and hairline dividers (`--rule-2` between items, `--rule` around regions). They have no box, no border radius and no shadow.
3. **Only floating layers are surfaces.** A modal, a pop, a popover menu, a drawer, a toast and the event brief get a panel background, a border, a radius and a shadow. Nothing else floats.
4. **Colour means status or change.** Blue, green, red, amber and teal show the 5 statuses and the line state. Yellow shows what a change request changed. Grey shows everything else, selection included.
5. **Plain English in the UI.** Use short, common words: "Move the date", "Hand over", "Not now", "Show again". Do not use jargon such as "commit", "diff", "ops" or "rev" in UI text.
6. **Every pointer action has a keyboard and click way.** Every drag has a click alternative in a pop or a modal. Every SVG target is a button with a label.

## 2. Colour tokens

The base tokens live on `:root` in `globals.css`. The tracker tokens (change, edit tint, event kinds) live on `:root` in `tracker.css`. Each set has 3 blocks: light on `:root`, dark on `:root[data-theme='dark']`, and dark again under `@media (prefers-color-scheme: dark)` for `:root:not([data-theme='light'])`. When you change a dark value, change both dark blocks.

The theme toggle in the rail cycles system, light and dark. It sets `data-theme` on `<html>` and keeps the choice in `localStorage` under `pg-theme`.

### 2.1 Surfaces, ink and lines

| Token | Light | Dark | Role |
|---|---|---|---|
| `--page` | `#f0f0f3` | `#0d0d0f` | Page backdrop. No rule uses it today. |
| `--panel` | `#ffffff` | `#18191b` | The main background of the app, the board, pops, drawers and modals. Text on ink fills (`.btn-ink`, toast, T pill). |
| `--surface` | `#ffffff` | `#18191b` | Global components: `.btn`, `.card`, tables, menus, top bar. Same value as `--panel`. |
| `--sunk` | `#f9f9fb` | `#111113` | Recessed areas: the rail, search inputs, the Main context bar, alternate lane bands, button hover. |
| `--gray-bg` | `#f0f0f3` | `#272a2d` | Neutral fills: segmented control track, chips, the current rail item, the picked menu or list item. |
| `--hover` | `rgb(28 32 36 / 0.045)` | `rgb(237 238 240 / 0.06)` | Hover wash on list rows, menu items and icon buttons. |
| `--ink` | `#1c2024` | `#edeef0` | Main text, the ink button, the toast, the selection outline. |
| `--ink-2` | `#60646c` | `#b0b4ba` | Secondary text: labels, idle controls, lane names. |
| `--ink-3` | `#696c74` | `#90949d` | Captions, timestamps, placeholders, the T line, the Planned status. One step darker than Radix gray 10, so small captions pass AA. |
| `--rule` | `#e0e1e6` | `#2e3135` | Borders of controls and floating layers, region dividers. |
| `--rule-2` | `#f0f0f3` | `#212225` | Hairlines between list items, graph day grid. |
| `--trunk` | `#1c2024` | `#edeef0` | The milestone line on the graph and the History timeline. |
| `--focus` | `#0d74ce` | `#70b8ff` | Keyboard focus ring. Use it for nothing else. |
| `--scrim` | `rgb(11 12 16 / 0.38)` | `rgb(0 0 0 / 0.62)` | Backdrop behind a modal. |
| `--mark` | `#ffe770` | `#524202` | Not used today. Use `--change-bg` for a change mark. |
| `--stripe` | `#f9f9fb` | `#111113` | Not used today. |
| `--isolated` | `#8b8d98` | `#696e77` | The neutral line of a cancelled work item and its status dot (round 10B). Mapped to the Tailwind colour `isolated`. |

### 2.2 Status colours

Each status hue has 3 steps. Use the right step for the job:

- **Line step** (`--route`, `--proceed`, ...): graph lines, milestone circles, deadline diamonds, dots and progress bars. It is too light for small text on white.
- **`-ink` step**: text in that hue, for example a status word or a milestone label. It passes AA on `--panel` and on its own `-bg`.
- **`-bg` step**: the fill of a badge, a chip, a callout or a context bar. Always put the `-ink` text on it.

| Hue | Line light / dark | `-ink` light / dark | `-bg` light / dark | Meaning |
|---|---|---|---|---|
| route (blue) | `#0090ff` / `#0090ff` | `#0c6bbe` / `#70b8ff` | `#e6f4fe` / `#0d2847` | An open work item line. Links (`.lnk`). The read-only notice. The context bar of someone else's change request. |
| proceed (green) | `#46a758` / `#46a758` | `#287939` / `#71d083` | `#e9f6e9` / `#1b2a1e` | Done line. Status Finished on time. A done handoff source. Added lines in a review card. |
| danger (red) | `#e5484d` / `#e5484d` | `#c62a2f` / `#ff9592` | `#feebec` / `#3b1219` | The part of an open line after its own Planned finish. Status Late. Errors, the bin, removed lines in a review card. |
| caution (amber) | `#ef5f00` / `#ef5f00` | `#b44500` / `#ffa057` | `#ffefd6` / `#331e0b` | The part of a done line after its own Planned finish. Status Finished late. The ask row and resolved clashes. |
| teal | `#0d9b8a` / `#12a594` | `#007b6a` / `#0bd8b6` | `#e0f8f3` / `#0d2d2a` | Status Finished early. |

The 6 statuses map to tones in `STATUS_TONE` (`src/tracker/layout.ts`). Cancelled is for work items only: a milestone is never cancelled (spec decision 6).

| Status | Tone | Badge class | Milestone circle | Deadline diamond |
|---|---|---|---|---|
| Planned | `--ink-3` | `.st-planned` (`--gray-bg`, `--ink-2`) | Outline only | Outline only |
| Finished early | `--teal` | `.st-early` | Filled, tick | Filled |
| Finished on time | `--proceed` | `.st-ontime` | Filled, tick | Filled |
| Late | `--danger` | `.st-late` | Filled, "!" | Filled |
| Finished late | `--caution` | `.st-flate` | Filled, "!" | Filled |
| Cancelled | `--isolated` | `.st-cancelled` (no fill, 1px `--rule` ring, `--ink-2`) | Not used | Not used |

A cancelled row draws one `--isolated` line from its start to the Cancelled event and nothing after it. It is never red and never amber, whatever its planned finish.

### 2.3 Change mark (C2 yellow highlighter)

The owner chose C2 on 17 October 2026. Yellow marks what a change request changed, and nothing else.

| Token | Light | Dark | Role |
|---|---|---|---|
| `--change` | `#e0a800` | `#ffe629` | Strokes: the 3-unit ring around a changed event, the 3-unit stroke of a changed milestone circle or a moved deadline diamond. Round 7 made it more saturated so it reads in both themes. |
| `--change-bg` | `#ffe14d` | `#6e5a00` | The highlighter behind a changed name (an SVG text stroke of 11 px painted under the text), the `.chipx.pen` chip, the count on the draft button, the legend sample. |
| `--change-text` | `var(--ink)` | `var(--ink)` | Text on `--change-bg`. |
| `--edit-bg` | `#fefce9` | `#1b180f` | The context bar of a change request that you edit (`.bbar.mine`). |

### 2.4 Event kind colours

The `--k-*` tokens colour the kind icon in the Queue cards, the event pops, the stack list, the event list of the details drawer, the legend and the graph. On the graph, kinds colour the events (the ring, the tint inside it, the icon, the Dense dot and the stronger tint of the circles behind a stack), and status colours the row lines (owner ruling 18 Oct, K1: "the status of a work item already shows in the colour of its line"). Task is grey and Meeting is brown, so no kind looks like the yellow change mark or a pink or violet mark. Cancelled shares the grey of Task, and its circle-slash icon tells the two apart (owner ruling 18 Oct, T1).

| Kind | Token | Light | Dark |
|---|---|---|---|
| Message | `--k-message` | `#0c67b6` | `#70b8ff` |
| Task | `--k-task` | `#60646c` | `#b0b4ba` |
| Handoff | `--k-handoff` | `#0e738c` | `#4ccce6` |
| Decision | `--k-decision` | `#975800` | `#ffca16` |
| Meeting | `--k-meeting` | `#9e5426` | `#dbb594` |
| Delivery | `--k-delivery` | `#54722b` | `#d4ff70` |
| Issue | `--k-issue` | `#be282d` | `#ff9592` |
| Done | `--k-done` | `#1e744e` | `#3dd68c` |
| Idea | `--k-idea` | `#3a5bc7` | `#9eb1ff` |
| Cancelled | `--k-cancelled` | `#60646c` | `#b0b4ba` |

The kind picker (`KindGrid`, in the event modals and the kind pop) groups the kinds under small uppercase labels (`.kg-label`, 10.5px weight 600, `--ink-3`): Start (Idea, Message, Issue), Progress (Task, Meeting, Decision, Delivery) and Finish (Handoff, Done, Cancelled). The groups are guidance only. Each group is a 4-column grid of `.kind` buttons, also on a phone. For a Handoff the picker adds the check box "This finishes the work item" (`.check`).

On the graph an event circle is a 2-unit ring in the full kind colour around a tint of the same colour mixed into `--panel`: `--k-tint` (12 % light, 16 % dark) for the front circle and `--k-tint-back` (26 % light, 30 % dark) for the circles behind a stack (owner, 18 Oct: "colour the outer ring too, not only the icon"). Light stays at 12 % because the Handoff icon on a 14 % tint measured 4.48. No kind colour moved a Radix step: each one passes on its tint (§2.5), and a step more saturated (step 9 or 10) falls under 4.5 for the icon.

### 2.5 Measured contrast

WCAG contrast ratios of the current values (text needs 4.5, lines and marks need 3):

| Pair | Light | Dark |
|---|---|---|
| `--ink` on `--panel` | 16.39 | 15.15 |
| `--ink-2` on `--panel` | 5.94 | 8.45 |
| `--ink-3` on `--panel` / `--sunk` / `--gray-bg` | 5.25 / 5.00 / 4.62 | 5.79 / 6.20 / 4.75 |
| `-ink` on its own `-bg` (route, proceed, danger, caution, teal) | 4.85, 4.85, 4.85, 4.90, 4.67 | 7.08, 7.91, 7.75, 7.83, 8.07 |
| `--ink` on `--change-bg` | 12.59 | 5.79 |
| Line step on `--panel` (route, proceed, danger, caution, teal) | 3.26, 3.03, 3.91, 3.33, 3.46 | 5.39, 5.80, 4.49, 5.28, 5.73 |
| `--focus` on `--panel` | 4.77 | 8.37 |
| `--k-task` on `--panel` / its 12 % tint | 5.94 / 5.03 | 8.45 / 6.73 |
| `--k-meeting` on `--panel` / its 12 % tint | 5.60 / 4.72 | 9.26 / 7.30 |
| Event ring on `--panel` / `--sunk` (message, task, handoff, decision, meeting, delivery, issue, done, idea, cancelled) | 5.78, 5.94, 5.46, 5.66, 5.60, 5.50, 5.95, 5.73, 6.00, 5.94 / 5.50, 5.65, 5.19, 5.38, 5.33, 5.23, 5.66, 5.45, 5.70, 5.65 | 8.37, 8.45, 9.29, 11.49, 9.26, 15.36, 8.35, 9.38, 8.53, 8.45 / 8.97, 9.06, 9.96, 12.32, 9.92, 16.47, 8.95, 10.06, 9.15, 9.06 |
| Event icon on its `--k-tint` (same order; 12 % light, 16 % dark) | 4.86, 5.04, 4.61, 4.78, 4.74, 4.69, 4.91, 4.85, 5.04, 5.03 | 6.17, 6.18, 6.73, 7.93, 6.66, 9.79, 6.19, 6.81, 6.28, 6.18 |

The owner picked `#a35829` for Meeting in light. On its 12 % tint (the round icon of a pop or the stack list) it measured 4.47, so the token is one small step darker, `#9e5426`, with the same hue.

Measure again when you change a colour. Do not put line-step colours on small text.

## 3. Typography

- **Family.** Geist for all UI text (`--f-ui`, `--f-doc`), Geist Mono for ids, secrets, code snippets and diff lines (`--f-id`). `next/font` loads both in `src/app/layout.tsx` as `--font-geist` and `--font-geist-mono`. SVG text uses `--f-ui`.
- **Base.** `400 var(--fs)/1.5`, letter spacing `-0.005em`, antialiased.

| Token or size | Value | Use |
|---|---|---|
| `--fs` | 13.5px | Body text, pops, drawers, modals, textareas, big buttons. |
| `--fs-s` | 12.5px | Controls (buttons, inputs, segmented control, menus), list titles, facts. |
| `--fs-xs` | 11.5px | Meta text, chips, badges, captions, timestamps. |
| 10.5px, weight 600, upper case, `0.07em` spacing | `.q-label`, lane names | Section labels in drawers and the Queue; team names on the graph. |
| 11px / 12px | | Axis ticks, counts (`.cnt`); row labels on the graph, `.id` mono text. |
| 15px, weight 600 | | Drawer and modal titles. |
| h1 20px, h2 17px, h3 14px, weight 600, `-0.015em` | | Page headings. The review title is 21px. |

Weights: 400 for body text, 500 for controls and chips, 600 for titles, names and the picked item, 700 only for small counts (filter count, handoff count).

## 4. Radii

| Token | Value | Use |
|---|---|---|
| `--r-ctl` | 8px | Buttons, inputs, selects, the segmented control track, context notices, the zoom bar, icon buttons. Menu items use a fixed 8px; segment buttons inside a track use 6px. |
| `--r-pop` | 12px | Pops, popovers, menus, the filter and search panels, tables, `.card`, the toast. |
| `--r-sheet` | 14px | Drawers, modal cards, the empty-graph notice, the New project dialog. |
| `99px` / `999px` | | Chips, badges, counts, pills, the hidden-count badge. |
| 4px | | Graph marks: handoff mark, hidden-source chip, focus button. |

## 5. Spacing and density

The CSS has no spacing tokens. Use the values below and match the code around you.

- Step values: 2, 4, 6, 8, 10, 12, 14, 16, 18, 22 px.
- Control height: 32px (`.btn`, inputs, selects, the search). Small: 28px (`.btn.sm`, icon buttons, the hidden badge). Big: 40px (`.btn.big`, sign-in).
- Bars: the top bar (`.p-head`) has a minimum height of 52px and padding `10px 12px`. The context bar (`.bbar`) has a minimum height of 48px and padding `8px 12px`.
- Lists: rows have `10px 0` or `10px 12px` padding and a `--rule-2` top border.
- Widths: rail 212px (56px folded), change request side panel 320px, drawer 380px, pop 312px, modal 620px, search from 160px to all the free room, filter and search panels 380px. Secondary pages (Members, Settings): one centred column of up to 1200px with 24px gutters (16px on a phone) for the head and the body; Settings splits into the tokens and a 340px to 420px Connect your agent column from 1180px.
- Graph density: three row heights, `ROW_LEVELS` in `src/tracker/layout.ts`. Comfortable is a 32-unit row, Compact (the default) a 20-unit row, Dense a 12-unit row. The team summary row is 40 units (32 at Dense). Indent 12 units per level (3 levels at most). Marks scale with the row (see section 9), and every click target stays at least 12 units. Each person's choice stays in the browser.
- Phone (760px and less): 16px side gutters, the rail becomes a sticky top bar, the top bar puts History, Change requests and the account on the first line and the search on the last, the side panel stacks above the graph and its cards scroll sideways, a drawer covers the full height below the rail. The page has no horizontal scroll at 390px.

## 6. Shadows and layers

| Token | Light | Dark | Use |
|---|---|---|---|
| `--shadow-sm` | `0 1px 2px rgb(16 24 40 / 0.05)` | `0 1px 2px rgb(0 0 0 / 0.3)` | Buttons, selects, the pressed segment. |
| `--shadow` | `0 10px 30px -6px rgb(16 24 40 / 0.16)` | `0 12px 32px -6px rgb(0 0 0 / 0.6)` | Pops, menus, popovers, drawers, the zoom bar, tooltips, the drag ghost. |
| `--shadow-lg` | `0 24px 60px -12px rgb(16 24 40 / 0.28)` | `0 28px 70px -12px rgb(0 0 0 / 0.7)` | Modal cards, the toast, the New project dialog. |

Stacking order (`z-index`), low to high: pinned axis, zoom bar and bin 3; move hint 4; pop 6; drawer and handoff tooltip 7; handoff list 8; view menu and hidden popup 11; search and filter panels 12; folded rail 60; full view 65; modal 70; toast 80; drag ghost 90.

## 7. Icons

- Set: Lucide shapes (ISC licence) on a 24px grid, copied as inline SVG paths into `src/components/tracker/icons.tsx` (`Icon`, `KindIcon`, `SvgIcon`) and `src/components/shell/icons.tsx` (`RailIcon`). Do not add an icon font or an icon package.
- Stroke: `currentColor`, width 2, round caps and joins. The Done kind and the `check`, `branch`, `cornerUp`, `cornerDown` and `upDown` shapes use width 2.4, so they stay clear at 10px. `grip` is the only filled shape.
- Sizes: 16px by default, 14px in buttons and the zoom bar, 12px to 13px for the eye and focus buttons on the graph, 13 units inside an event circle, 10 units inside a graph mark.
- Kinds: `idea` (lightbulb), `message` (mail), `issue` (triangle alert), `task` (clipboard check), `meeting` (people), `decision` (scales), `delivery` (package check), `handoff` (two arrows), `done` (double check), `cancelled` (circle slash).
- UI shapes: `eye`, `eyeoff`, `plus`, `pencil`, `move`, `trash`, `undo`, `check`, `x`, `tag`, `diamond`, `list`, `inbox`, `sidebar`, `chev`, `branch`, `focus`, `cornerDown`, `cornerUp`, `upDown`, `filter`, `maximize`, `minimize`, `loop`, `grip`, `search`, `bot`, `lock`, `pr`, `merge`, `share`, `history`, `flag`, `link`, `info`, `cal`. Rail shapes: `graph`, `settings`, `theme`, `signOut`, `panel`, `chevron`.
- An icon next to text is decorative (`aria-hidden="true"`). An icon-only button needs an `aria-label` and a `title`.

## 8. Components

### 8.1 Buttons

| Class | Look | Use |
|---|---|---|
| `.btn` | `--panel` fill, 1px `--rule` border, `--r-ctl`, `--shadow-sm`, 32px, `--fs-s` weight 500. Hover: `--sunk`. | Default action. |
| `.btn-ink` | `--ink` fill, `--panel` text. Hover: opacity 0.9. | The one main action of a bar, a modal or a drawer (Create, Merge into Main, Move the date). One per area. |
| `.btn-draft` | Default look with a `.cnt` count on `--change-bg`. | The change request button that counts your changes. |
| `.btn-danger` | Default look, `--danger-ink` text. | Remove. |
| `.btn.sm`, `.btn.big` | 28px and `--fs-xs`; 40px and `--fs`. | Dense rows; sign-in. |
| `:disabled` | Opacity 0.4 (0.45 for the global `.btn`), `not-allowed` cursor. | Keep the button visible and say why in a tooltip or a line of text. |
| `.lnk` | No box, `--route-ink`, weight 500, underline on hover. | Inline links in text and lists. |
| `.x` | No box, a 20px `×` in `--ink-3`. | Close a pop, a drawer, a modal or a notice. |
| `.ib` | No box, 28px, `--ink-3`. Hover: `--hover` and `--ink`. | Icon-only buttons. |

### 8.2 Chips, badges and counts

- `.chipx`: a pill on `--gray-bg` with `--ink-2` text, `--fs-xs` weight 500. Variants: `.warn` (caution), `.ok` (proceed), `.route` (blue), `.pen` (change yellow, for "changed" labels only).
- `.badge` with `.st-*`: the status badge. Always pair the hue with its word.
- `.wi-hint`: a quiet note in the work item details, under the status row: an `info` icon in `--ink-3` and `--fs-s` text in `--ink-2` on `--sunk`, `--r-ctl`, no border. Only the start hint uses it (spec decision 1).
- `.cnt`: an 18px round count on `--gray-bg`. On an ink button it uses 22 % of `--panel`.
- `.fchip`: filter chips in the filter panel. Idle: 1px `--rule` border, `--ink-2`. Checked: `--gray-bg`, `--ink` border and text, weight 600. Status chips start with an 8px status dot.
- `.hid-pill`: the "N hidden" badge at the right end of the context bar, 28px, `--gray-bg`. Hover or open: `--rule` fill.
- `.nbadge`: the app icon badge on the Change requests button: an 18px pill in `--danger` with white 10.5px weight 600 text and a 2px `--panel` ring, at the top right corner of the button. It counts the Ready change requests and is absent at 0. It is the only solid red count in the app.
- `.bot`: the Agent chip on a Queue card, on `--route-bg`.

### 8.3 Inputs

- `.field`: a label (`--fs-xs` weight 500, `--ink-2`) above the control. Inputs and selects are 32px with a 1px `--rule` border, `--r-ctl` and `--panel` fill. A textarea has a minimum height of 64px and `--fs` text.
- Focus: the border turns `--focus` and a 3px ring of `--focus` at 18 % shows around it. No outline.
- Disabled input: `--sunk` fill, `--ink-3` text.
- Dates and times use the app's own boxes, never the browser's date or time controls (no `type="date"`, `type="time"` or `type="datetime-local"`, not even hidden). Code: `src/components/tracker/DateInput.tsx`, `TimeInput.tsx`, `DateTimeInput.tsx`, `FieldPop.tsx`, `fields.css`; parsing in `src/tracker/time.ts`.
  - `DateInput`: a text box in the app format "6 Oct 2026" (it also reads "6 October", "6 Oct" and "2026-10-06") with a 28px calendar icon button inside its right edge (Open the calendar). The calendar is a popover: month name (weight 600) with Previous month and Next month, a 6-week grid from Monday of 32 × 30px day buttons (`--r-ctl`), and a footer with Today (and Clear on an optional box). Days of other months are `--ink-3`; today (the project's T day) is weight 600 with a 1px `--rule` ring; the picked day is an `--ink` fill with `--panel` text; hover is `--hover`. Keys: the arrows move a day or a week, Page Up and Page Down a month (with Shift a year), Home and End the week, Enter picks, Esc closes and returns the focus to the button. An empty box shows the placeholder "Date".
  - `TimeInput`: a text box in 24-hour "14:30". It reads "1430", "930", "9" (09:00) and "9:5" (09:05). A click or the arrow keys open a list of times in 30-minute steps (rows 8px radius, the current time weight 600 on `--gray-bg`, the active row `--hover`); the list opens at the current time, or at 09:00 when the box is empty. An optional box starts the list with "No time". A click only opens the list; Esc, a click outside or a pick close it. Enter saves the typed time; it picks the active row only after the arrow keys moved it. An empty box shows the placeholder "Time", never "--:--".
  - `DateTimeInput`: a group of a `DateInput` (Date) and a `TimeInput` (Time) side by side; it reads and writes the `YYYY-MM-DDTHH:mm` wall time of the project.
  - Popovers (`.field-pop`): the top layer, so a modal, a drawer or the New project dialog never clips them; `--panel`, 1px `--rule`, `--r-pop`, `--shadow`. They open under the box, or above it when the room below is too small, and stay inside the screen with an 8px edge. Esc closes the popover first, then the modal or the drawer.
  - Saving: while the person types, a box saves only whole text (a day with a 4-digit year or a full ISO day; a time with two minute digits, or 4 digits). Short text such as "6 Oct", "9" or "143" saves on Enter or when the box loses the focus. Text that is not a day or a time (or a year before 1000) is never saved: the box gets a `--danger` border (also on hover and focus, with a 3px ring of `--danger` at 18 %) and a tooltip with an example, and when it loses the focus it returns to the value it had when it got the focus. Enter in a box with unsaved text saves it and does not submit the form.
  - Names: the calendar popover is the dialog "Calendar", the time list is the listbox "Times".

### 8.4 Search with filter

- `.tsearch`: a 32px input on `--sunk` with the search icon at the left and the filter button inside the right edge. It takes all the free room of the top bar (at least 160px); on a phone it takes the full line.
- Hover: `--ink-3` border. Focus: `--panel` fill and the input focus ring.
- `.tsearch-pop`: up to 8 results, each with the title (weight 600), the team (`--fs-xs`, `--ink-3`) and a status badge. The active result has `--gray-bg`. Arrow keys, Enter and Esc work.
- `.tfilter-btn`: a 28px icon button. While filters are on, it shows a count on an ink pill. `.tfilter-pop` holds the groups Status, Team, Milestone and Person as `.fchip` groups, and a footer with "N of M work items match" and Clear filters.

### 8.5 Segmented control

`.seg`, `.qseg` and `.srcs` share one look: a `--gray-bg` track with 2px padding and `--r-ctl`, buttons with 6px radius in `--ink-2`. The pressed button has `aria-pressed="true"`, a `--panel` fill, `--ink` text, `--shadow-sm` and a 1px `--rule` ring. Focus: a 2px `--focus` outline inside the button.

### 8.6 Menus and popovers

- Menus (`.gmenu` view switcher, `.hid-pop`, `.proj-menu`, `.hand-menu`, `.menu ul`): `--panel` fill, 1px `--rule` border, `--r-pop`, `--shadow`, 4px to 12px padding. Items are 8px radius rows with `--hover`; the current item is weight 600 on `--gray-bg`. A `--rule-2` hairline separates groups.
- Menus built on `<details>` close on Esc (the focus goes back to the summary) and on a pointer press outside (`useDismissibleDetails` in `src/components/shell/Popover.tsx`).
- Pops (`.pop`, the event brief, the stack list, the kind picker): 312px, `--r-pop`, `--shadow`, padding `12px 14px`. The head has a 30px round icon on a 12 % tint of the kind colour. A quote sits in a `blockquote` on `--sunk`. Edit buttons show only in an editable view.
- Tooltips on graph marks (`.hand-tip`): `--ink` fill, `--panel` text, `--fs-xs` weight 600, 7px radius.

### 8.7 Drawer

`.drawer-slot` covers the right side of the graph canvas: 380px wide, 8px inset, full height. The drawer is a `--panel` surface with a 1px `--rule` border, `--r-sheet` and `--shadow`, padding `14px 16px`, and its own scroll. Titles are 15px. Sections start with a `.q-label`. Facts use a two-column `dl.facts`. Lists inside use hairlines, not cards. A sticky `.drawer-foot` holds the main action. The drawer takes the focus without a ring. On a phone it takes the full height below the rail, with a left border only and no radius.

### 8.8 Modal

`.tk-modal` is a fixed `--scrim` backdrop, 48px from the top. `.m-card` is 620px wide at most, `--panel`, 1px `--rule`, `--r-sheet`, `--shadow-lg`, padding 18px. The head (`.m-top`) has a 15px weight 600 title and a close button. The footer (`.m-foot`) puts the ink button first and lets it grow. Esc closes the modal first.

### 8.9 Toast

`.tk-toast` sits at the bottom centre, 20px from the edge: `--ink` fill, `--panel` text, `--r-pop`, `--shadow-lg`. An action (Undo) is an outline button in 40 % `--panel`.

### 8.10 Rail

The rail is flat: `--sunk` fill and a 1px `--rule` right border. Items (`.rail-item`) are 32px rows with a 16px icon and `--ink-2` weight 500 text. The current page has `aria-current="page"`, `--gray-bg` and `--ink` weight 600. The project switcher shows a 24px ink square avatar. Folded, the rail is 56px wide and shows a tooltip with the name on hover and focus. On a phone the rail is a sticky top bar.

### 8.11 Top bar and context bar

- `.p-head` (top bar): `--panel`, a `--rule` bottom hairline. It holds Search work items (all the free room), History, Change requests with its `.nbadge`, New change request, the demo select (upper-case 10.5px label) and the acting member (28px avatar, name, role) after a `--rule` divider.
- `.bbar` (context bar): says what the view is and what you can do. It starts with the view selector (`.gpick > .vsel`): the title of the view in `--fs` weight 600 with a pull-request icon (a 10px ink dot for Main) and a chevron, no box; hover or open: `--hover`. A long title ends with an ellipsis at 56 characters. The last control of its first line is the "N hidden" badge (`.hid-menu`), only while something is hidden; on a phone its popup spans the bar. `.bbar.main` on `--sunk`, `.bbar.mine` on `--edit-bg` (you edit), `.bbar.other` on `--route-bg` (someone else's change request). The ask row (`.ask-row`) is a full-width line on `--caution-bg`; a note (`.bnote`, the cancel reason or the "asked for changes" note) is a full-width `--fs-s` line in `--ink-2`.
- `.cr-side` (side panel of the change request page): 320px, the Changes and Queue tabs as a `.qseg`, a list of changes as rows with hairlines (`.chg-row`; the picked one on `--gray-bg`), the clash picks (`.res-box`) at the top. `.gtools` above the graph holds the Before / After `.seg`.
- `.btn-stop`: a solid `--danger` button with white text, only for the confirm button of Cancel change request.
- `.ro-note` (Main is read-only): `--route-bg` with `--route-ink` text, `--r-ctl`, a close button and Don't show again.
- `.legend2`: a `--fs-xs` legend below the graph with the 5 line colours (Cancelled included), the deadline diamond, the 5 milestone statuses and the yellow "Name" sample.

### 8.12 Tables of people and teams (Members page)

- `src/components/members/members.css`. The page is full width: no narrow column. Each table is rows on one CSS grid template, a `--rule` line under the column heads (`--fs-xs`, `--ink-3`) and `--rule-2` hairlines between rows; no card.
- People: avatar 28px, name weight 600, email and role label in `--fs-xs` `--ink-3`, `.chipx` for Project lead / You / Invited, teams with a small upper-case "LEAD" in `--ink-3`, four centred native checkboxes with `accent-color: var(--ink)`, row actions as `.btn.sm` (Remove is `.btn-danger`). A box that a rule holds is disabled and its tooltip says why.
- Below 1180px the row actions go under the person; at a phone width each row stacks (person, teams, the four boxes in two columns with their names, actions), and the team rows show Lead and People captions.
- The New project dialog lists its teams the same way: rows with hairlines and an `×` icon button (26px, `--ink-3`, hover `--hover`), then an input with Add.

## 9. Graph marks

Geometry in view-box units (`GEOMETRY` in `src/tracker/layout.ts`): width 1060, label column `SIDE` 228, time line from `X0` 236 to `X1` 1046, axis text at y 15, milestone labels at y 33, milestone line at y 48, rows start below `TOP` 64. Zoom goes from 1 to 12, each step ×1.5, and stretches only the time line.

| Mark | Drawing |
|---|---|
| Team summary row | Alternate lanes get a `--sunk` band. The first row of each lane is a button (`aria-expanded`), one line 28 units high (24 at Dense): a chevron (right when collapsed), the team name in 10.5px weight 600 upper case `--ink` with " · N" items in `--ink-3`, and the focus and eye buttons (16 units, 12 at Dense) at the right of the label column. A name too long for that line ends with an ellipsis 6 units before the focus button, cut by grapheme. The counts above zero of "N late · N not yet · N done" sit in the lane of the row, in `--fs-xs` `--ink-3` (the late part `--danger-ink` weight 600, the done part `--proceed-ink`), centred in the row and pinned 8px from the left edge of the visible time line while it scrolls. A collapsed team that holds a change gets the yellow highlighter on its name, as a changed row label does. A team with no shown work items has no chevron and is not a button. Hover: `--hover`. Keyboard focus: a 1px `--ink-3` ring inside the row; a mouse click leaves no ring. A collapsed team shows this row only. A neutral `--rule` guide joins the rows of an open team in the label column. |
| Row height | Comfortable / Compact / Dense (`ROW_LEVELS`): row 32 / 20 / 12 under a team summary row of 28 / 28 / 24, label 12 / 11 / 9.5px, event radius 10 / 7 / 3 with a 13 / 9 / no icon, line 3 / 2.5 / 2, diamond half 6 / 4.5 / 3.5, handoff box 14 / 12 / 10, chip 14 / 12 / 10, eye and focus buttons 18 / 16 / 12, + radius 9 / 7 / 5, milestone name 9.5 / 9 / 8px, stack distance 16 / 12 / 7 units. At Dense an event is a filled dot in its kind colour, the waiting text moves to the tooltip, the receiver count leaves the Handoff icon, and the milestone name sits on the row centre only where the row has no line. Every target keeps a hit area of at least 12 units. The view menu (rows icon) at the left of the zoom bar holds Row height (a segmented control) and Expand all / Collapse all. |
| Row label | 12px `--ink`, indented 12 units per level. A changed name gets the yellow highlighter. A row in the picked milestone is weight 600. A filter context row shows at 50 % opacity. |
| Row line | 3 units, round caps. `--route` while open, `--proceed` when done. The part after the row's own Planned finish is `--danger` while open and `--caution` when done. A row with no events shows a `--ink-3` line at 45 % opacity and an italic "Waiting for ..." or "No events yet". |
| Event | A circle of radius 10 (Comfortable) with a 2-unit ring in its full kind colour (`--k-*`, at every row height), filled with a `--k-tint` tint of that colour over `--panel`, and the Lucide kind icon (13 units) in the same colour. The row line keeps the status colour. Events closer than the stack distance form a stack: up to 2 offset circles behind, filled with the stronger `--k-tint-back` tint of the kind colour of the top (latest) event. A changed event gets a yellow ring 5 units wider (a 3-unit `--change` stroke, 30 % fill). Events sit at their own time; nothing drags them inside the day. |
| T line and pill | A solid 1-unit `--ink-3` line at the demo clock or now. The pill on the axis is an `--ink` capsule (88 × 17) with `--panel` text. |
| Milestone line | A 4-unit `--trunk` line with round caps. A coloured segment shows a slip: `--danger` from the date to the T line while late, `--caution` from the date to the finish when finished late, `--teal` from the finish to the date when finished early. |
| Milestone circle | Radius 8, stroke 2 (3.5 when picked). Filled with the status tone; Planned is an outline. A tick for finished early or on time, "!" for late or finished late, both in `--panel`. A changed milestone gets a 3-unit `--change` stroke. The label "name · date · status" is 11px weight 600 in the `-ink` step, on 2 levels when labels collide. |
| Deadline diamond | On every member row at noon of the milestone date: a 12-unit diamond, stroke 1.5 (2.5 on hover, focus or pick). Filled with the milestone status tone; Planned is an outline. A moved date gets a 3-unit `--change` stroke. The milestone name shows once per team and milestone (9.5px weight 600, `--panel` halo) beside the first member row, or not at all when it has no room. |
| Handoff mark | One symbol per source row. When the source has a Handoff event, its event icon (or the stack that holds it) is the mark: no separate badge, a 3-unit ring on hover or open (the tint stays `--k-tint`, so the icon keeps 4.5:1), and the receiver count (8.5px weight 700, `--ink-2`, `--panel` halo) on the top right of the ring when there are several receivers. Without a Handoff event the mark sits after the finish (or after the T line while open): a 14 × 14 box, 24 wide with a count, radius 4, `--panel` fill and `--ink-3` stroke; the arrow (`cornerUp`, `cornerDown` or `upDown`, 10 units) is `--proceed` for a done source, `--danger` for an open one and `--isolated` for a cancelled one (which never uses its Handoff icon as the mark); hover or open: `--gray-bg` fill and `--ink` stroke. |
| Hidden-source chip | A 14-unit square, radius 4, `--panel` fill, `--ink-3` stroke, the `branch` icon in `--ink-2`. Only direct children of a hidden source get it. |
| Add button | In an editable view, a radius-9 circle with a `+` at 20 units right of the T line on each open row. |
| Selection band | The row with open details: a band of 6 % `--ink` and nothing else. The reveal flash and the picked review row: 8 % `--ink`. A drop target while you drag: 9 % `--ink` with a 2-unit `--ink` outline. |
| Focus ring | A thin 1px `--focus` stroke with `vector-effect: non-scaling-stroke` on the row hit area (it reads as a line above and below the row); a `--focus` outline on milestone circles. |
| Focus button | On each row and each team summary row, left of the eye: an 18-unit square (smaller with the row height), radius 4, the `focus` icon. Pressed: a `--focus` fill with a `--panel` icon. |
| Bin | Shows only while you drag: a sticky box at the bottom left with a `--danger` border and `--danger-ink` text; `--danger-bg` and scale 1.06 when the pointer is over it. |
| Zoom bar | Floats at the bottom right of the graph: the view menu (Row height and teams), Zoom out, Zoom in, Fit and Full view in a `--panel` box with `--r-ctl` and `--shadow`. Its buttons show the focus ring for the keyboard only: no ring after a click, and none when Esc closes a menu that a click opened. The view menu opens above the bar, from its right end, as a `--r-pop` popover; Esc and a press outside close it. It moves left of an open drawer. |
| Legend | Below the graph: the line colours, the deadline diamond, the 5 milestone statuses, the change mark, then the 10 kinds (icon in its kind colour, name in `--ink-2`). |

## 10. Graph rules

These rules come from the spec and the owner rulings. Do not change them without an owner decision.

1. The graph draws no connector: no line from the milestone line to a work item, no line from a parent to its child, no "leads from" curve, no ghost line for a hidden source. A child row sits indented under its parent in the same team.
2. A "leads from" link shows only as one handoff mark per source row. Hover and focus list each receiver: "Handed over to <team> · received in <work item>". A click jumps to the receiver, or opens a short list when there are several.
3. The axis band (dates, T pill, milestone line) stays pinned at the top while the rows scroll. Scrolls that bring a row into view stop below the pinned axis.
4. A hidden row or team leaves no row, no line and no link. A team with no shown rows takes no room, except a team with no work items in the window, which keeps its empty lane as a drop target.
5. An event is drawn at its own time.
6. Milestones have no chip column at the row end. The deadline diamond on each member row tells which milestone the row belongs to.
7. Main and every view that you cannot edit show information only: no drag that changes the graph, no edit buttons, no `+` buttons. The sideways move of an event inside its day works everywhere.
8. Every SVG target has `role="button"`, `tabindex="0"`, an `aria-label`, and Enter or Space activates it.

## 11. Accessibility

- **Contrast.** Text meets WCAG AA (4.5:1) in both themes; lines and marks meet 3:1 on `--panel`. See section 2.5. Status always has a word or an icon as well as a colour.
- **Focus.** Use `:focus-visible` with a 2px `--focus` outline and a 2px offset. Inputs use the border and ring style of section 8.3. Drawers, pops and modal cards take the focus without a ring, and their controls keep theirs. Never remove a focus style without a replacement.
- **Toggles.** A button that stays on uses `aria-pressed` (segmented controls, Full view, the focus button, chip toggles). A button that opens a list uses `aria-haspopup` and `aria-expanded`.
- **Esc order.** One Esc closes one layer. First an open `<details>` menu, the search list or the handoff list closes itself. Then the page closes, in this order: the modal, the move mode, the pop, the drawer, the focus, and last the full view. In real full screen the browser takes the first Esc and leaves full screen; the board follows.
- **Keyboard.** Every drag has a click way. The search list works with arrow keys, Enter and Esc. The handoff list closes on Esc, on Tab and when the focus leaves it.
- **Motion.** Keep transitions short (0.15s to 0.2s). Animations on the sign-in page run only under `prefers-reduced-motion: no-preference`.
- **Phone.** Check 390px width: no horizontal page scroll. The graph keeps a 900px frame and scrolls sideways inside its canvas.

## 12. Never

- No dashed or dotted lines, anywhere: graph, borders, dividers, focus rings, option pages.
- No pink, magenta or violet for a change mark. Change is yellow (`--change`, `--change-bg`).
- No coloured edge stripe on a card, a row or a callout (no thick left border in a status colour).
- No status colour for selection, hover or focus. Selection is a grey ink band; focus is `--focus`.
- No cards for the rail, the Queue or the lists in drawers. Use bold text and hairlines.
- No connector lines on the graph (see section 10).
- No new colour, radius, shadow or font size outside the tokens and values above. Add a token first, in both themes, and record the decision.
- No jargon in UI text. Use plain English words, the same word for the same action everywhere.
- No hard-coded hex colours in components. The only exception is `#fff` text on member avatars.

## 13. Change this system

1. Build an HTML option page in `docs/design/` (see AGENTS.md, UI rules) and let the owner choose.
2. Change the tokens in `globals.css` or `tracker.css`, in all 3 theme blocks.
3. Update this file and `docs/design/design-system.html` in the same commit.
4. Measure the contrast again and update section 2.5.
