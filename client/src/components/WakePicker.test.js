// WakePicker: waking the idle wallpaper offers only the family
// members as big photo circles with names (Gavin's design). There is
// deliberately no Default/household entry on this screen, and a pick
// travels to the profile switcher, which owns loading a member's
// side, so the two member UIs can never drift apart.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PICKER = readFileSync(resolve(__dirname, 'WakePicker.jsx'), 'utf8');
const SWITCHER = readFileSync(resolve(__dirname, 'ProfileSwitcher.jsx'), 'utf8');
const APP = readFileSync(resolve(__dirname, '../app.jsx'), 'utf8');

describe('WakePicker', () => {
  it('is a fixed full-screen overlay above the dashboard layers', () => {
    expect(PICKER).toContain("position: 'fixed'");
    expect(PICKER).toContain('zIndex: 1250');
    expect(PICKER).toContain('data-testid="wake-picker"');
  });

  it('shows members as big photo circles with their name under each', () => {
    expect(PICKER).toContain('<Avatar');
    expect(PICKER).toContain('profilePhotoUrl(entry.user)');
    expect(PICKER).toContain('entry.user.username');
    expect(PICKER).toContain('entry.user.username.charAt(0)');
  });

  it('has no Default or household entry, only member circles', () => {
    expect(PICKER).not.toContain('Default');
    expect(PICKER).not.toContain('Wallpapers');
    expect(PICKER).not.toContain('useHousehold');
  });

  it('sends a pick to the profile switcher, which applies that member', () => {
    expect(PICKER).toContain('onPick?.(entry.user.id)');
    expect(APP).toContain('WAKE_PROFILE_PICK_EVENT');
    expect(APP).toContain('onPick={handleWakePick}');
    expect(SWITCHER).toContain('WAKE_PROFILE_PICK_EVENT');
    expect(SWITCHER).toContain('applyRef.current(entry)');
  });

  it('can be reached instantly: the profile row has a Sleep chip wired to sleepNow', () => {
    expect(SWITCHER).toContain('onSleep');
    expect(SWITCHER).toContain('Sleep');
    expect(APP).toContain('onSleep={() => wakeCycleRef.current?.sleepNow()}');
  });

  it('is wired to the wake cycle picker phase in app.jsx', () => {
    expect(APP).toContain("visible={dashboardPhase === 'picker'}");
    expect(APP).toContain('createIdleWakeCycle');
    expect(APP).toContain("dashboardPhase !== 'active'");
    expect(APP).toContain('onEmpty={() => wakeCycleRef.current?.choose()}');
  });

  it('is the landing flow: a page load starts on the wallpaper, not the dashboard', () => {
    expect(APP).toContain("const startPhase = fadeHideMs != null ? 'idle' : 'active'");
    expect(APP).toContain('initialPhase: startPhase');
    expect(APP).toContain('useState(startPhase)');
  });
});
