import { describe, expect, it } from 'vitest';
import { IDLE_FADE_TIMEOUT_MS, idleFadeTimeoutMs } from './idleFade.js';

describe('idleFade', () => {
  it('fades after 2 minutes on desktop', () => {
    expect(IDLE_FADE_TIMEOUT_MS).toBe(2 * 60 * 1000);
    expect(idleFadeTimeoutMs({ isMobile: false })).toBe(IDLE_FADE_TIMEOUT_MS);
  });

  it('never fires on mobile', () => {
    expect(idleFadeTimeoutMs({ isMobile: true })).toBeNull();
  });
});
