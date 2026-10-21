# et-qa reference

## Driver

- Start: `bash $K/env.sh driver <run> <P> <D>`. It records the PID, so `env.sh down` stops the driver.
- Send: `bash $K/drive.sh <D> <<'JS' ... JS`. The body is an async function of `page`, `state`, `newCtx(name, contextOptions)` and `browser`. It returns its value as JSON, with the page errors and HTTP errors since the last call.
- Sign in: `await page.goto('/signin?label=<label>'); await page.getByRole('button', { name: /continue/i }).click();`
- A second person: `const p = await newCtx('b')`, then sign in with another label.
- Screenshots: absolute paths in `<out>/explore/`. Never capture a token secret: close the secret panel first.
- Open a report: `await page.goto('file://<out>/bao-cao-qa.html')`.

## Traps

| Symptom | Cause and fix |
|---|---|
| A sign-in lands in the wrong sandbox | A label allows `a-z`, `0-9` and `-` only. `an.dev` signs in as the shared user `dev`. The email of label `x` is `x@local.test`, so invite that email to reach that user. |
| A click on a milestone or an event times out | The group includes a long label. Click its `circle`/`rect`. Scroll it into view first. For the pinned axis, press Fit, because the axis cannot scroll. |
| `selectOption` fails: "not a <select>" | The app uses its own Select (a `combobox` button and a `listbox`). Use `pick()` in `checks.mjs`, or click the combobox and then the `option`. |
| Fit does not respond | Fit is disabled at the fit scale. |
| A `getByText` on the context bar matches 2 elements | The view menu repeats status words in hidden rows. Use `text=… >> visible=true`. |
| Revoke does nothing | Revoke shows an inline **Confirm revoke**. |
| Save milestone does nothing | A date change opens the dialog "Move the milestone date", which needs a reason. |
| Remove from queue keeps the card | The toast says "Used in #N": another change request uses it. Remove a card that you added. |
| Ctrl and the wheel do not zoom | Playwright's wheel has no Ctrl. Dispatch `new WheelEvent('wheel', { ctrlKey: true, deltaY: -300, bubbles: true, cancelable: true })` on `svg.pg`. |
| Rows do not change after focus | Teams can be folded. Count the team heads, or press Expand all. |
| A fill on a fresh page is lost | React reset the input during hydration. Fill again until `inputValue()` matches. |
| Another user's page shows old data | The page polls every 5 s. Wait 6 s. |
| A change count looks wrong | Read the change request from `GET /api/v1/projects/<id>/tracker` (`crs[].ops`). The counter can lag a render. |
| A phone team menu closes before a tap on its item | A tap or `focus()` near the screen edge scrolls the page, and a scroll closes every graph menu. Scroll the head to the centre first. |
| A full-page phone shot shows Skip to content | A fixed element in a `fullPage` shot moves with the page scroll. Check a viewport shot before you report it. |
| A rate limit answers 500 INTERNAL under `next dev` | Dev compiles each route on its own, so the limiter on `globalThis` throws an `AppError` of another route. Check the limit in the production image before you rate it. |
| A demo visitor lands on `/welcome?reason=busy` | The address made 30 demo copies in this clock hour. Wait for the next hour; restart a local server to reset its count. |
| A collab check fails only on live after Ask to edit and an act-as switch | Act as skips the write queue (finding L1 of 19 Oct). Wait for the answer of a write before the next act-as. |
| A check waits for a seed date and times out | Since round 23 a demo copy follows the real clock, so every seed date moves each day. Read the date from the page or the API; never write a seed date in a check. |
| The "New changes" notice never comes | The check runs every 5 minutes (round 23). Dispatch `visibilitychange` on the page to check at once, or install `page.clock` before the first load and `runFor` the time. |
| A token secret shows in a video | `--video` and `tour.mjs` blur `[data-testid="token-secret"]`. Check a frame of every new secret panel. |
| The production image answers 500 to every request but `/welcome` | `NODE_ENV=production` refuses an `http:` `NEXT_PUBLIC_APP_URL`. Use `https://qa.example`, send `Origin: https://qa.example` on writes, and `Host: qa.example` to `/mcp`. |

## API

Base `/api/v1/projects/<id>/`: `tracker` (GET), `members` (GET, POST), `members/<memberId>` (PATCH, DELETE), `teams` (POST), `teams/<teamId>` (PATCH, DELETE), `agent-tokens` (GET, POST), `agent-tokens/<tokenId>` (DELETE), `tracker/act-as`, `tracker/queue`, `tracker/crs`, `tracker/crs/<num>/ops`, `tracker/crs/<num>/actions` (POST), `tracker/queue/<id>`, `tracker/crs/<num>/ops/<index>` (DELETE). `POST /api/v1/projects` makes a project. MCP: `POST /mcp` with `Authorization: Bearer <token>`.

A write needs `Origin: http://localhost:<P>`. Without it the server answers 403 for the origin, and you learn nothing about the rights. The `api` area checks every route for 401 without a session, 404 for a stranger, and 403 from another origin.

## Files in `<out>`

- `findings.json`: a list of `{ "id", "severity", "title", "detail", "repro", "evidence", "fix", "shots": [] }`. Write the text in Vietnamese. Ids: `H1`, `M1`, `L1`.
  - `high`: blocks a main flow, loses data, or breaks a right.
  - `medium`: a wrong result with a workaround, or hidden content.
  - `low`: text, a message, polish, or an accessibility name.
- `manual.json`: a list of `{ "text", "result": "pass" | "fail" | "skipped", "note" }`. Use the `text` of each manual or uncovered inventory item. A `fail` also needs a finding.
- The scripts write `results.json`, `inventory.json`, `gates.txt`, `run.json`, `checks/`, `shots/`, `demo/` and `explore/`.

## Coverage

`coverage.md` holds 3 lists that `inventory.mjs` reads:

- **Manual**: controls that need a hand test, each with how to test it.
- **Covered by a pattern**: controls that a check finds with a regular expression.
- **Not testable locally**: controls with a reason.

When the app adds a control, the inventory prints it as uncovered. Add a check for it, or add it to one of these lists.
