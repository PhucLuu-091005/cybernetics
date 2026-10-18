---
name: et-ui-qa
description: Use after any UI change in the event tracker repo, before you report it - takes light and dark screenshots at 1440 px and 390 px, measures horizontal scroll, dashed or dotted lines and page errors, then you look at every image against the owner's rules.
---

# Check the UI

A screen is done only when you looked at it in light and dark, at 1440 px and 390 px. A script measures what a browser can measure. You check the rest with your eyes.

## 1. Take the screenshots

Start your own dev server in your worktree (never port 3100, 3200 or 3310), then run from the worktree root:

```sh
node .claude/skills/et-ui-qa/shoot.mjs --base http://localhost:<port> --out <scratch>/shots-<task> \
  --pages graph,members,settings,changes/2
```

- The script signs in with a new local user (`/signin?label=qa`), which seeds the Larkspur demo, and opens each page under `/projects/<id>/`.
- `--widths` and `--themes` change the defaults `1440,390` and `light,dark`.
- For a state that needs clicks (an open drawer, a popover, a dialog, an edit mode), write a Playwright step in your e2e test or a scratch script, and save a screenshot of that state too. Name the files `<topic>-<width>-<theme>.png`.

The script prints `ok` or `CHECK` per image, with the measured problems:

- a horizontal page scroll;
- a dashed or dotted border, or an SVG `stroke-dasharray`;
- a page error or a console error.

Its exit code is 1 when it finds a problem.

## 2. Look at every image

Open each image with the Read tool. Check each item:

- Nothing is cut, overlaps or sits outside its box. Labels fit, or end with an ellipsis on purpose.
- No empty frame or blank panel where content belongs.
- Dark mode has no light patches, and no text that is too faint to read.
- At 390 px the first view shows the useful part of the screen.
- The owner's rules (AGENTS.md, "UI rules"):
  - no dashed or dotted lines;
  - yellow is the only change mark, never pink or violet;
  - no coloured edge stripes;
  - selection never uses a status colour;
  - no connector lines on the graph;
  - few cards: lists are rows with hairlines;
  - plain English words in the app.
- The tokens from `docs/design-system.md`: no new colour, radius, shadow or font size.

## 3. Fix and repeat

Fix each problem, take the screenshots again and look again. In the report, list the screenshot folder and each problem that you found and fixed.
