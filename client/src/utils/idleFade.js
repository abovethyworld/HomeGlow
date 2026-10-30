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
