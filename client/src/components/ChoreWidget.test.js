// ChoreWidget: the widget's settings block (which members are
// hidden, bonus chores, sounds) lives on the device and a profile
// tap can replace it via a linked setup apply. The widget stays
// mounted across that swap, so it must reload the block when the
// dashboard announces new device settings or configuration, or it
// keeps showing the previous profile's chore view (a kid's chart
// still listing the parents) until the page is refreshed.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const WIDGET = readFileSync(resolve(__dirname, 'ChoreWidget.jsx'), 'utf8');

describe('ChoreWidget settings reload', () => {
  it('loads its device settings through a reusable callback', () => {
    expect(WIDGET).toContain('const loadDeviceWidgetSettings = useCallback');
    expect(WIDGET).toContain('void loadDeviceWidgetSettings();');
  });

  it('reloads on both device update events a profile tap can fire', () => {
    expect(WIDGET).toContain("const DEVICE_SETTINGS_UPDATED_EVENT = 'homeglow:device-settings-updated'");
    expect(WIDGET).toContain("const DEVICE_CONFIG_UPDATED_EVENT = 'homeglow:device-config-updated'");
    expect(WIDGET).toContain('window.addEventListener(DEVICE_SETTINGS_UPDATED_EVENT, reload)');
    expect(WIDGET).toContain('window.addEventListener(DEVICE_CONFIG_UPDATED_EVENT, reload)');
    expect(WIDGET).toContain('window.removeEventListener(DEVICE_SETTINGS_UPDATED_EVENT, reload)');
    expect(WIDGET).toContain('window.removeEventListener(DEVICE_CONFIG_UPDATED_EVENT, reload)');
  });
});
