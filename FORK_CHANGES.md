# Fork changes

This fork adds a family wall board on top of HomeGlow. This file tracks
every change made here, why it exists, and why it might interest upstream.
It is the record we will share with the HomeGlow project when the time comes.

## Shipped

### Family board: Today-only overview (`/board`) — 2026-10-26

- What: a new route and view built for a kitchen wall display. It shows
  today only: the full date, a weather line, today's events, a total
  chores-left count, and one button per person with their remaining count.
  Tapping a profile shows that person's chores.
- Why: the dashboard's Month/Week calendar is too much for a glanceable
  wall display at a child's touch height. A wall board needs today, now.
- Upstream idea: a dedicated glanceable "today" view as an alternative to
  the full dashboard, aimed at wall-mounted displays.

### Profile chores: big tap-to-complete buttons — 2026-10-26

- What: chores on a profile are large tappable buttons (88px minimum
  height) that complete and undo through the same endpoints the dashboard
  widget uses. Double-tap guard, plain-language error text, and a
  "Done today" section under the open chores for undoing.
- Why: wall taps need to be forgiving. A missed tap target or an
  accidental tap should never corrupt the day's data.
- Upstream idea: touch-first chore cards with undo, sized for wall use.

### Board polish: hide the bonus pseudo-user, default weather city — 2026-10-26

- What: the internal bonus pseudo-user no longer appears as a profile
  button, and the board's weather request defaults to the household city.
- Why: internal accounts should never leak into a family-facing view.
- Upstream idea: filter system accounts out of any people picker.

### Site naming: Eden — 2026-10-26

- What: tab title, app manifest, and board header use the household's
  chosen name for the board.
- Why: the wall board is a family object, not a product demo. It should
  carry the family's name.
- Upstream idea: none, household-specific. Listed for completeness.

## Planned (not built yet)

### Pattern ownership for date-anchored chores

- Problem: a chore fixed to a calendar date (for example, windows on the
  1st, cars on the 15th) cannot be assigned to "whoever's weekday it
  falls on", because cron treats a restricted day-of-month and
  day-of-week as either-or. Today the workaround is rotating by month
  parity, which is fair but not what the household asked for.
- Idea: a "pattern" flag on a schedule. A flagged schedule exists as one
  row per parent with the same date, and only the row belonging to
  whoever owns that date under the household's weekday pattern shows up.
  The date check lives in two spots (server and board client), so both
  learn the same rule.
- Possible extension: a weekly flip of the whole pattern, so a chore
  fixed to Sundays alternates owners instead of sitting with one parent
  until someone reassigns it by hand.
- Status: scope not yet picked. Nothing here is built.
