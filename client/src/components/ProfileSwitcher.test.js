// ProfileSwitcher layout: the chips get their own row at the top of the
// dashboard, in normal flow, so they can never float over the first widget
// row and cover a widget's settings gear. They used to be position:fixed
// at the top-right corner, which did exactly that (worse when the chips
// wrapped on a narrow screen and spread over more of the row).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SWITCHER = readFileSync(resolve(__dirname, 'ProfileSwitcher.jsx'), 'utf8');
const APP = readFileSync(resolve(__dirname, '../app.jsx'), 'utf8');

describe('ProfileSwitcher layout', () => {
  it('is not fixed-positioned, so it takes layout space instead of overlaying widgets', () => {
    expect(SWITCHER).not.toContain("position: 'fixed'");
    expect(SWITCHER).not.toContain("position: 'absolute'");
    expect(SWITCHER).not.toContain('zIndex: 1200');
  });

  it('is positioned relative with a zIndex, so the row paints above the fixed wallpaper layers that would cover it', () => {
    // The video/scene background layers are position:fixed with no
    // zIndex, painted after the switcher in DOM order. A plain in-flow
    // row loses to them and the chips vanish under the wallpaper; a
    // relative row keeps its layout height AND wins the paint order.
    expect(SWITCHER).toContain("position: 'relative'");
    expect(SWITCHER).toContain('zIndex: 1100');
  });

  it('lays the chips out as a wrapping row, so a narrow screen grows the row instead of spilling over widgets', () => {
    expect(SWITCHER).toContain("flexWrap: 'wrap'");
    expect(SWITCHER).toContain("justifyContent: 'flex-end'");
  });

  it('renders no member circles and no Default: picking a person happens only at the wake picker', () => {
    expect(SWITCHER).not.toContain('<Avatar');
    expect(SWITCHER).not.toContain('members.map');
    expect(SWITCHER).not.toContain('apply(null)');
    expect(SWITCHER).toContain('Sleep');
    expect(SWITCHER).toContain('Wallpapers');
  });

  it('still owns the member photo machinery the wake picker uses', () => {
    expect(SWITCHER).toContain('/Uploads/users/');
    expect(SWITCHER).toContain('profilePhotoUrl');
    expect(SWITCHER).toContain('WAKE_PROFILE_PICK_EVENT');
  });

  it('fades out with the idle fade, staying mounted so waking never shifts the layout', () => {
    expect(SWITCHER).toContain('faded = false');
    expect(SWITCHER).toContain("opacity: faded ? 0 : 1");
    expect(SWITCHER).toContain("pointerEvents: faded ? 'none' : 'auto'");
    expect(APP).toContain('faded={dashboardIdle}');
    expect(APP).toContain('idleFaded={dashboardIdle}');
  });

  it('renders before the widget layouts in app.jsx, so widgets start below the row', () => {
    const switcherAt = APP.indexOf('<ProfileSwitcher');
    expect(switcherAt).toBeGreaterThan(-1);
    expect(APP.indexOf('<MobileDashboard')).toBeGreaterThan(switcherAt);
    expect(APP.indexOf('<WidgetContainer')).toBeGreaterThan(switcherAt);
  });
});
