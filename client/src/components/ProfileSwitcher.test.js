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
    expect(SWITCHER).not.toContain('zIndex: 1200');
  });

  it('lays the chips out as a wrapping row, so a narrow screen grows the row instead of spilling over widgets', () => {
    expect(SWITCHER).toContain("flexWrap: 'wrap'");
    expect(SWITCHER).toContain("justifyContent: 'flex-end'");
  });

  it('renders before the widget layouts in app.jsx, so widgets start below the row', () => {
    const switcherAt = APP.indexOf('<ProfileSwitcher');
    expect(switcherAt).toBeGreaterThan(-1);
    expect(APP.indexOf('<MobileDashboard')).toBeGreaterThan(switcherAt);
    expect(APP.indexOf('<WidgetContainer')).toBeGreaterThan(switcherAt);
  });
});
