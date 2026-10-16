# Fixtures

The Larkspur Capital Fund III onboarding demo (vendor Fundline) is fictional data. It now lives in code, not in JSON files: [src/server/tracker/seed/larkspur.ts](../src/server/tracker/seed/larkspur.ts). This folder holds no data file, no build script and no gold file.

## The demo

`larkspurState()` and `larkspurBase()` return the people, the 7 teams, the 2 milestones (CRM integration live and Go-live and first close), the work items with their planned finish dates and recorded moves, and their events. `larkspurQueueRows()` returns the Queue: 4 events and 2 work items. `larkspurCrs()` returns the 4 change requests: #1 "Explain the go-live slip" (merged as Main revision 1), #2 and #3 (ready; they clash on the PG-203 name), and #4 (a draft that Hà shares with Khoa).

The demo clock is `LARKSPUR_AS_OF` (2026-10-09 18:00 in Asia/Ho_Chi_Minh), and the graph window starts on `LARKSPUR_WINDOW_START` (2026-09-10).

## Story keys

The story uses short keys (`minh`, `sarah`, `golive`, `pg203`, `qe1` and so on). A function argument `id: (key) => string` maps a key to the id that the app stores. Unit tests keep the keys. The database seed maps the member keys and the Queue keys to fresh UUIDs, because those rows have global primary keys.

## Sandbox seed

`seedTrackerDemo` (`src/server/tracker/projects.ts`) runs inside the first sign-in transaction. It creates the project row ("Larkspur Capital, Fund III onboarding", client "Larkspur Capital"), the tracker with the demo clock, the 5 members (Minh owns Main and links to the signed-in user), the Queue rows, and the 4 change requests with their comments and shares. It replays the change of each request on Main as it was when the request was made, and it stops with an error if a change does not apply.
