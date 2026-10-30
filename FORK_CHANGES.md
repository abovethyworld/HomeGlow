# Fork changes

This fork adds a family wall board on top of HomeGlow. This file tracks
every change made here, why it exists, and why it might interest upstream.
It is the record we will share with the HomeGlow project when the time comes.

## Shipped

### Dashboard profile switcher: see everyone's background — 2026-10-30

- What: the dashboard gains chips (top right) for Default and each
  family member with a wallpaper. Tapping a member writes this
  display's appearance overrides: their wallpaper as the background
  and their palette as the interface colors, light and dark.
  Default drops the overrides and the household look returns. A
  new personalization background kind, "scene", paints a scene
  wallpaper's animated preview behind the widgets.
- Why: Gavin wanted to see everyone's backgrounds from the screen
  he actually looks at, not only on the /board page. Per-display
  overrides keep it local to the screen in front of you; the
  household default never changes.
- Upstream idea: a "who is looking" switcher driven by data a
  plugin maintains.

### Mode-split interface colors (colorsDark) — 2026-10-30

- What: the appearance gains an optional `colorsDark` field, a second
  interface color set that dark mode wears when present (light mode
  and unset appearances are unchanged). Every wallpaper palette now
  carries a light set and a dark set derived from its art; the
  household's colors and colorsDark are the default wallpaper's two
  sets, and `/board` swaps each member's palette variant with the
  household mode.
- Why: Gavin asked for the theme colors to follow the wallpaper in
  both modes, not just one. Upstream idea: mode-aware interface
  colors, so a palette never has to compromise between modes.

### Family board step 4: per-member backgrounds and accents — 2026-10-29

- What: `/board` wears the household's default background (the same
  appearance background the dashboard uses). Opening a profile swaps
  in that member's wallpaper, taken from the Wallpaper Engine
  plugin's package index in plugin storage, and tints the profile
  view and the member's overview button with the wallpaper's own
  scheme color. The 60s idle return falls back to the default.
  Scene wallpapers stand in with their animated preview GIFs until
  their browser rebuilds land.
- Palette pass (same night): every package also carries a palette
  derived from its preview art (average, soft, deep, accent,
  secondary; the accent is the wallpaper's own scheme color). The
  board's wash, headings, and buttons draw from the active
  wallpaper's palette, so the theme follows the wallpaper. The
  dashboard does the same for the default: setting the Cozy
  Cottage video as the household background also set the household
  interface colors from its palette.
- Why: Gavin's model for the board: one shared default look, and
  every family member gets their own background and theme when
  they open their view.
- Upstream idea: per-user appearance on a shared display, resolved
  from data a plugin already maintains.

### Personalization: video backgrounds — 2026-10-29

- What: the personalization background gains a `video` kind. It points at
  a wallpaper package imported by the Wallpaper Engine plugin
  (`/Uploads/wallpapers/<workshop id>/<file>.mp4`, with an optional still
  poster from the same package) and a new `VideoBackground` layer plays
  it muted and looping behind the widgets, in the same layer position as
  the theme ambience. Reduced motion shows the poster instead. The
  setting is the ordinary household/device appearance, so it scopes and
  saves like every other background; no server change was needed, the
  appearance value is opaque to the settings store and /Uploads already
  streams with range support.
- Why: the household's wallpapers are videos. A still photo background
  (the upstream kinds) cannot show them moving.
- Upstream idea: a video kind for personalization backgrounds, sourced
  from files the server already streams.

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

### Idle return: back to the shared view after 60s — 2026-10-26

- What: while a profile is open, any tap, click, or key press restarts a
  60-second clock; 60 seconds without one returns the board to the shared
  Today overview. The five-minute data refresh is not activity and never
  resets the clock. The dashboard's own screensaver does not run on the
  board route, so the timer lives in the board itself.
- Why: a wall board is shared. If someone walks away mid-profile, the next
  person should find the family view, not the last person's chores.
- Upstream idea: an idle-return-to-home option for kiosk and wall
  displays, separate from the screensaver.

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

### Pattern ownership: alternating household schedules — 2026-10-26

- What: a schedule can be flagged as pattern-owned instead of fixed to one
  person. A flagged schedule exists as one row per household member with the
  same date, and only the row belonging to whoever owns that date shows up.
  Ownership comes from a household pattern setting: two members, their
  weekday sets, and an anchor Sunday. Every other week the two sets swap,
  so a chore fixed to a Sunday, or to the 1st or 15th of a month, changes
  hands on its own. Chores explicitly pinned to one person (a single-owner
  job, a child's jobs, each person's own medication, a shared job with a
  default owner) never flip. The owner rule lives in both date checks (the
  board and the server's nightly job), so the other member never logs a
  miss for a chore that was never theirs that week. Existing rows were
  updated in place and mirror rows added, so no past history was orphaned.
- Why: cron treats a restricted day-of-month and day-of-week as either-or,
  so a fixed date could never mean "whoever's weekday it falls on". The
  month-parity workaround was fair but not what the household asked for.
- Upstream idea: a generic alternating-household pattern for couples and
  families who split chores by weekday and want the split to rotate
  without hand-editing schedules. Known gap in this version: the dashboard
  chore widget does not pattern-gate yet; only the board does.

## Planned (not built yet)

Nothing at the moment.
