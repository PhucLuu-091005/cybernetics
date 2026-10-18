---
name: et-option-page
description: Use when a visual or product question in the event tracker needs the owner's choice - builds one self-contained HTML option page in docs/design/ with each option drawn on the Larkspur data in light and dark, a recommendation, Vietnamese explanations and a copyable answer line.
---

# Build an option page

The owner decides visual questions from an HTML page, never from a description or an Artifact. Build the page before you build the feature.

## Rules

- One self-contained file: `docs/design/YYYY-MM-DD-<topic>-options.html`. It opens from the file system with no server. It may load only Google Fonts (Geist, Geist Mono).
- Start from `template.html` in this folder. Copy the current token values from `src/app/globals.css` and `src/components/tracker/tracker.css` into its `:root` blocks, so the page shows the colours that the app has today.
- Draw each option on the real Larkspur data from `src/server/tracker/seed/larkspur.ts`: real team names, work item titles, people and dates. Draw the real screen around the change (the drawer, the row, the graph part), not an abstract box.
- Show every option in light and dark. The template has `.th-light` and `.th-dark` frames that sit side by side.
- Give 2 to 4 options. Name them with a letter and a number (`O1`, `K2`). Keep the current look as an option when it is a real choice.
- Recommend one option with a green "Đề xuất" pill, and say why in 1 or 2 sentences. Say what each option gains and what it loses.
- Write the explanations in Vietnamese, in short plain sentences. Keep the app text inside the frames in English, as the app is.
- Follow the owner's rules in the drawings too (AGENTS.md, "UI rules"): no dashed or dotted lines, yellow as the only change mark, no edge stripes, few cards.
- End with the answer bar: the owner picks in segmented controls, and the bar builds one answer line with a Copy button.

## Check

- Open the page at 1440 px and 390 px, in light and dark, with Playwright. The page has no horizontal scroll and no page error. Look at the screenshots.
- Fix every overlap, cut label and empty frame.

## Hand it to the owner

Give the file path (not a link) and one short question. The question must name the options and the recommendation. Build nothing until the owner chooses. Then write the choice into the spec and the ledger.
