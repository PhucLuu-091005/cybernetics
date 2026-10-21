# Coverage that the scripts do not reach

`inventory.mjs` reads this file. An entry is the control text that the inventory prints, in backticks.

## Manual

Test each of these by hand in step 5 of a full run, and say in the report what you saw.

- `Review again`: open a ready change request as the merger, change it from a second browser of another member (sign in with an invited label), dispatch `visibilitychange` on the first page so it checks at once, then press Refresh and Review again.
- `Newest`: needs more entries than one page holds; add tokens or merges until the pager shows, then press Older and Newest.
- `Older`: see Newest.
- `Save name`: rename a work item in the details with the Save name button instead of Enter.
- `Open the Queue`: hide the side panel on a change request page that you edit, then open the Queue from the graph.
- `Show the events here`: open a handoff mark with several receivers that sits on a stack and press Show the N events here. The seed has no such stack since round 23: add a Queue event at the time of the Analyse handoff, attach it to Analyse in a change request, then open the mark there.
- `Request changes on #`: the dialog of Request changes; check its title and its Esc.
- `Hidden teams and work items`: the hidden list popover; check Tab and Esc.
- `Try again`: stop the dev server for a moment on a page that loads data, then press Try again after it is back.
- `Go to your projects`: the link on the error page. Wait for a URL with your project id: the 404 URL also ends in `graph`.

## Covered by a pattern in checks.mjs

These controls have a changing text, so `checks.mjs` finds them with a regular expression that the inventory cannot read.

- `· focus on it instead`: graph, "focus a work item, move the focus to its parent".
- `Date moves First planned · moved ×`: graph, "Date moves in the details".
- `Main Read-only · project lead`: collab, "the view selector goes back to Main".

## Not testable locally

- `Continue with Google`: AUTH_MODE=local has no Google sign-in. Test it on the deployed app.
