// Idle fade for the widget dashboard (fork feature, Gavin's vision for
// Eden): after 2 minutes without a tap, click or key press, the widgets,
// the profile row and the dock fade out and only the animated wallpaper
// stays, like a screensaver that is just the wallpaper. Any activity
// brings everything back.
//
// Desktop only, like the screensaver and the dock hide (issue #118):
// phones lock themselves, and their layout has no wallpaper-only mode.
// The timer itself is the dock's idle timer (utils/dockIdleHide.js),
// which already implements poke / suspend / dispose with onChange only
// firing when the state flips; this module only owns the timeout.

export const IDLE_FADE_MINUTES = 2;
export const IDLE_FADE_TIMEOUT_MS = IDLE_FADE_MINUTES * 60 * 1000;

// Millisecond timeout for the fade timer, or null on mobile so the
// caller arms a timer that can never fire (the dock timer treats a
// null timeout as disabled).
export const idleFadeTimeoutMs = ({ isMobile }) => (isMobile ? null : IDLE_FADE_TIMEOUT_MS);

// How long the wake picker waits for a tap before the board drifts
// back to the wallpaper-only idle. Long enough to walk up and choose,
// short enough that an accidental wake (a bumped mouse) does not
// leave the picker sitting on the wall.
export const WAKE_PICKER_TIMEOUT_MS = 30 * 1000;

// The wake picker and the profile switcher are separate components;
// a pick travels as a window event carrying the member's user id, and
// the switcher (which owns the apply logic) loads that member's side.
export const WAKE_PROFILE_PICK_EVENT = 'homeglow:wake-profile-pick';

// The wake cycle behind the dashboard's idle behaviour: three phases
// where the dock timer has two.
//   active: the dashboard is up and the idle clock runs.
//   idle:   after the fade timeout without activity, everything has
//           melted away to just the wallpaper.
//   picker: the first activity on the idle wallpaper does NOT bring
//           the dashboard back (Gavin's call: waking never lands on a
//           default page). It offers the profile circles instead;
//           tapping one loads that member's side (choose()). Activity
//           in the picker only holds it open; after the picker
//           timeout of stillness it drifts back to idle.
// Suspended (Admin open, screensaver up) pins the cycle to active,
// like the dock timer, and a null idle timeout (phones) never leaves
// active at all. onChange(phase) fires only when the phase flips.
//
// The cycle starts in initialPhase. The dashboard passes 'idle' on
// desktop: Eden loads onto the wallpaper, not onto a dashboard
// (Gavin's call), and the way in is always the picker. Suspension at
// load (Admin open) still forces active, via setSuspended.
export function createIdleWakeCycle({
  idleTimeoutMs,
  pickerTimeoutMs = WAKE_PICKER_TIMEOUT_MS,
  initialPhase = 'active',
  onChange,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let timer = null;
  let phase = initialPhase === 'idle' ? 'idle' : 'active';
  let suspended = false;

  const set = (next) => {
    if (next === phase) return;
    phase = next;
    onChange(phase);
  };
  const disarm = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };
  // Only active and picker count down; idle just waits for activity.
  // Both countdowns land on idle: the fade from active, the drift
  // back from the picker.
  const armForCurrent = () => {
    disarm();
    if (suspended) return;
    const ms = phase === 'active' ? idleTimeoutMs : phase === 'picker' ? pickerTimeoutMs : null;
    if (ms == null) return;
    timer = setTimer(() => {
      timer = null;
      set('idle');
    }, ms);
  };

  armForCurrent();

  return {
    poke() {
      if (suspended) return;
      if (phase === 'idle') set('picker');
      armForCurrent();
    },
    choose() {
      if (suspended) return;
      set('active');
      armForCurrent();
    },
    // Skip the wait: drop straight to the idle wallpaper now (the
    // profile row's Sleep chip). The next activity opens the picker,
    // exactly as after a natural fade.
    sleepNow() {
      if (suspended) return;
      disarm();
      set('idle');
    },
    setSuspended(next) {
      suspended = next;
      if (suspended) {
        disarm();
        set('active');
      } else {
        armForCurrent();
      }
    },
    dispose() {
      disarm();
    },
  };
}
