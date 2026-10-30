# Fork changes

This fork adds a family wall board on top of HomeGlow. This file tracks
every change made here, why it exists, and why it might interest upstream.
It is the record we will share with the HomeGlow project when the time comes.

## Shipped

### Wake picker: waking the idle wallpaper offers the profiles — 2026-10-30

- What: waking the idle-faded dashboard no longer lands on the
  dashboard (never a default page). The wake cycle in utils/idleFade.js
  has three phases: active, idle (wallpaper only after 2 minutes),
  and picker. The first activity on the idle wallpaper opens the
  picker: one big photo circle per family member, name under it,
  over the wallpaper, and nothing else (no Default option). Tapping
  a circle loads that member's side through the profile switcher's
  own apply path (the pick travels as the homeglow:wake-profile-pick
  window event), and the dashboard returns. Activity in the picker
  only holds it open; after 30 still seconds it drifts back to the
  wallpaper. With no members to pick, the picker skips itself. The
  profile row also has a Sleep chip: it drops the board straight to
  the idle wallpaper (the cycle's sleepNow()), so the flow is one
  tap away instead of a 2-minute wait. A fresh page load starts in
  the idle phase too (the cycle's initialPhase): Eden opens on the
  wallpaper, never on the dashboard, and the picker is the way in
  from there as well. Finally, the dashboard's top row stopped
  offering the members and a Default button: once a side is loaded,
  the only way to switch people is Sleep, the wallpaper, and the
  picker. The row keeps Sleep and Wallpapers, and ProfileSwitcher
  keeps the member machinery the picker picks through. The idle
  and picker phases also paint the household background (the
  cottage) instead of the loaded member's: the theme tokens take
  the household appearance's background whenever the phase is not
  active, so a member's wallpaper shows only while their side is
  open (app.jsx paintedBackground).
- client/src/utils/idleFade.js (createIdleWakeCycle, picker timeout,
  pick event) + tests, client/src/components/WakePicker.jsx + tests,
  client/src/app.jsx (phase state + wiring), client/src/components/
  ProfileSwitcher.jsx (exports its member helpers, hears picks).

### Photo profile circles + idle fade to the wallpaper — 2026-10-30

- What: the dashboard profile switcher shows each member as a round
  photo circle (their HomeGlow profile picture, initial as fallback)
  with their name under it, instead of a text chip. Photos live
  server-side as the users' profile pictures, so every display shows
  them, and the chore widget's avatars pick them up too.
- Idle fade: after 2 minutes with no tap, click, or key press on a
  desktop display, the widget grid, the profile row, and the dock
  fade out, leaving only the animated wallpaper, screensaver style.
  Any activity brings everything back. Desktop only, suspended while
  Admin or the built-in screensaver owns the screen. The timer is
  the dock's idle timer; the timeout lives in utils/idleFade.js.
- client/src/components/ProfileSwitcher.jsx (photo circles, faded
  prop), client/src/app.jsx (idle state + wiring), client/src/
  components/WidgetContainer.jsx (grid fade), client/src/utils/
  idleFade.js + tests.

### Profile switcher: its own row, not an overlay — 2026-10-30

- What: the dashboard ProfileSwitcher no longer floats fixed at the
  top-right corner (zIndex 1200), where it covered the first widget
  row's header controls, including the settings gears. It renders in
  normal flow as its own row at the top of the dashboard, so the
  widget grid starts below it. On narrow screens the chips wrap
  inside the row, the row grows taller, and the grid moves down by
  the same amount. The row is position:relative with zIndex 1100:
  still in flow, but painted above the position:fixed wallpaper
  background layers, which covered a plain in-flow row completely.
- client/src/components/ProfileSwitcher.jsx (root Box positioning),
  plus a source-level test in ProfileSwitcher.test.js.

### Animated scene wallpapers: rebuilds with still posters — 2026-10-30

- What: a scene wallpaper package can carry an animated rebuild
  (`animated.webp` beside its still). The scene personalization
  background gains an optional poster: the switcher, the wallpaper
  assign route, and the /board layers all prefer the animated file
  and keep the scene's full-resolution still as its poster, which
  is what reduced-motion displays get. The importer passes an
  `animated.webp` dropped in a scene zip through to the package
  record. The two scene wallpapers on this board (Elden Ring,
  Sleep Token Fallen Leaves) gained 1920x1080, 12 fps, 6-second
  seamless-loop rebuilds composited from each scene's own
  full-resolution art with particle layers approximating the
  original presets (falling leaves, fog, light shafts, and a
  starfield for one; falling leaves and rising embers for the
  other). Shader effects (foliage sway, water flow, shine) are
  approximated or dropped, and audio-reactive parts stay out, as
  the scene rebuild verdict recorded.
- Why: scene wallpapers stood still. The packages' only animated
  asset is a 160px preview that can never be a background, so the
  scenes needed a playing form of their own at display size.
- Upstream idea: scene packages with a full-size animated form
  plus a still poster, so reduced-motion and slow displays get
  the still and everyone else gets the scene alive.

### Device setups: named configurations, defaults, and profile links — 2026-10-30

- What: a device's tabs/widgets configuration can be saved under a
  name ("Living Room", "Mobile Phone") as a server-side setup
  (Admin, Displays, Devices). Any device can apply a setup, which
  replaces its tabs and the setup's per-widget settings; saving
  under an existing name updates that setup. One setup can be
  marked default: a brand-new device with no configuration is
  seeded from it on first read, or from the earliest configured
  device when no default exists. A setup can also link to one
  family profile; tapping that profile in the dashboard switcher
  applies the linked setup to the display alongside the profile's
  wallpaper and palette. Appearance settings are never part of a
  setup.
- Why: Gavin rebuilt the board's widget setup by hand on every
  new screen, and when HomeGlow moved to a new address each phone
  came back to the empty first-run screen. Setups make a finished
  configuration reusable, and profile links let each person's
  screen follow them.
- Upstream idea: named, shareable device configurations with a
  designated default for first-run devices.
- Follow-up (schema 39, same day): a setup whose tabs carry the
  chores widget now also captures the chore widget's own settings
  block (hidden members, bonus chores, sounds, week view), which
  lives on the device outside widgetSettings. Applying the setup
  writes that block to the target device; a setup saved before
  the capture resets the block to the widget's defaults instead
  of leaving the previous viewer's settings behind. This is what
  lets a kid's setup be a chart of only their own chores while a
  parent's setup on the same screen still shows everyone's.
  Companion fix in the chore widget: it now reloads that settings
  block when the dashboard announces new device settings or
  configuration (the two events a profile tap fires). It stays
  mounted across a setup apply, and before this it kept showing
  the previous profile's chore view until a page refresh.

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

## Wallpaper importer + picker (2026-10-30, step 5)

Drop a Wallpaper Engine zip and it attaches itself. The picker (a
"Wallpapers" chip beside the profile chips on the dashboard) lists
every package as a card with its preview thumbnail, shows it on this
screen, assigns it to a member or the household default, and takes
new zips by drop or file pick.

- server/services/wallpaperImport.js: dependency-free import. Zips
  are read from disk entry by entry (the backend container has a
  256MB memory cap; a workshop zip can be 200MB, and the first
  buffered attempt OOM-killed the backend). Imports build in a
  staging folder and swap into place only on success, and extracted
  files are size-checked against the zip directory, so a truncated
  upload errors instead of attaching a broken video. Videos attach
  as-is; scenes give up their full-resolution main-layer art out of
  scene.pkg (image streams carved from the .tex files). Palettes
  derive from the preview GIF with a small GIF decoder, light and
  dark sets, accent from the project scheme color.
- Oversized videos (over 1920 wide) are flagged needsShrink and
  queued for server/scripts/wallpaper-shrink-watcher.sh, a host-side
  systemd timer job that swaps in a 1080p version at the same URL.
  A 4K encode does not fit the backend's memory cap, and the watcher
  must itself run under a hard memory limit: on 2026-10-30 an
  uncapped host encode wedged the 1GB VM hard enough to need a
  forced reboot from the cloud console. Do not run it uncapped.
- Hard rules, enforced server-side: the 160px preview is never a
  background (picker thumbnails only), and a display asset under
  1280px wide rejects the import with a plain reason instead of
  attaching something pixelated.
- server/routes/wallpapers.js: POST /api/wallpapers/import (streams
  the upload to a temp file), POST /api/wallpapers/assign (member
  assignments write the plugin's storage; "default" writes the
  household appearance), DELETE /api/wallpapers/:id. Re-importing a
  wallpaper keeps its assignment.
- Video work needs ffmpeg where node can run it: a static build at
  server/utils/bin/ffmpeg on the deployed VM (not committed), or
  WALLPAPER_FFMPEG pointing at one. Without it, scene imports still
  work and video imports say what is missing.
- client/nginx.conf: /api/wallpapers/import gets its own location
  (512m body cap, request buffering off, 900s timeouts), mirroring
  the backup route; the general /api/ cap stays 100m. On the VM the
  fixed template was copied into the running frontend container,
  which regenerates its config from it on start.

## Device setups carry plugin settings (schema 41)

A plugin widget sits in a setup's tabs like any other widget, but
it renders only on a display whose plugin settings enable its
file, and that enablement lives in the device settings, outside
the tabs. Setups now capture it the way schema 39 captured the
chore widget's settings: buildConfigSnapshot records the plugin
settings entries for the plugin files the snapshot's tabs carry,
a new plugin_settings_json column stores them, and applying a
setup writes them onto the target display (only for the plugins
the setup carries; other plugins' settings are untouched). A
plugin widget with no captured entry is enabled on apply, so a
setup saved before this capture still shows its plugins. This is
what lets a kid's saved side include plugin widgets (scoreboard,
countdown, games) and have them actually appear when his profile
is tapped on any screen.

## Upstream sync (Oct 30, 2026)

This fork stays synced with upstream on purpose (Gavin's call):
upstream's fixes and features keep flowing in, and the fork's own
changes stay a layer on top instead of a diverging rewrite. The
Oct 30 sync merged 23 upstream commits (Admin Panel redesign,
chore schedules by person with a week calendar, routine step
improvements, photo taken-on/place details, an Admin PIN fix).
Only three files conflicted.

Sync rules this merge established:

- Migration numbers: upstream's photoDetails arrived as their
  schema 37 after this fork had shipped 37 to 39 under the same
  numbers, so it runs here as schema 40
  (server/migrations/schema40-photoDetails.js). The runner applies
  migrations above a database's stored schema id, and Eden's
  database already sat at 39. Later upstream migrations get
  renumbered the same way at sync time.
- The fork's own migrations must stay re-runnable: upstream's
  timezone upgrade test rewinds a database to schema 25 and boots
  it again. schema39 now checks PRAGMA table_info before its
  ALTER TABLE, like upstream's migrations do (37 and 38 already
  guarded theirs).
- Admin Panel: the redesign's structure wins. The fork's Device
  Setups block moved into the redesigned Devices section as-is
  (its table markup predates the redesign; restyling it to
  AdminRow is cosmetic follow-up, not a merge blocker).

## Planned (not built yet)

Nothing at the moment.
