import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createIdleWakeCycle,
  IDLE_FADE_TIMEOUT_MS,
  idleFadeTimeoutMs,
  WAKE_PICKER_TIMEOUT_MS,
} from './idleFade.js';

describe('idleFade', () => {
  it('fades after 2 minutes on desktop', () => {
    expect(IDLE_FADE_TIMEOUT_MS).toBe(2 * 60 * 1000);
    expect(idleFadeTimeoutMs({ isMobile: false })).toBe(IDLE_FADE_TIMEOUT_MS);
  });

  it('never fires on mobile', () => {
    expect(idleFadeTimeoutMs({ isMobile: true })).toBeNull();
  });

  it('gives the wake picker 30 seconds before drifting back', () => {
    expect(WAKE_PICKER_TIMEOUT_MS).toBe(30 * 1000);
  });
});

describe('idle wake cycle', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const start = (idleTimeoutMs = 120_000, pickerTimeoutMs = 30_000) => {
    const phases = [];
    const cycle = createIdleWakeCycle({
      idleTimeoutMs,
      pickerTimeoutMs,
      onChange: (phase) => phases.push(phase),
    });
    return { cycle, phases };
  };

  it('fades to idle after the fade timeout, and activity opens the picker, not the dashboard', () => {
    const { cycle, phases } = start();
    vi.advanceTimersByTime(120_000);
    expect(phases).toEqual(['idle']);
    cycle.poke();
    expect(phases).toEqual(['idle', 'picker']);
  });

  it('activity in the picker holds it open, then it drifts back to idle', () => {
    const { cycle, phases } = start();
    vi.advanceTimersByTime(120_000);
    cycle.poke();
    vi.advanceTimersByTime(20_000);
    cycle.poke();
    vi.advanceTimersByTime(20_000);
    expect(phases).toEqual(['idle', 'picker']);
    vi.advanceTimersByTime(10_000);
    expect(phases).toEqual(['idle', 'picker', 'idle']);
  });

  it('choosing a profile returns to active and restarts the idle clock', () => {
    const { cycle, phases } = start();
    vi.advanceTimersByTime(120_000);
    cycle.poke();
    cycle.choose();
    expect(phases).toEqual(['idle', 'picker', 'active']);
    vi.advanceTimersByTime(119_999);
    expect(phases).toEqual(['idle', 'picker', 'active']);
    vi.advanceTimersByTime(1);
    expect(phases).toEqual(['idle', 'picker', 'active', 'idle']);
  });

  it('sleepNow drops straight to idle without waiting, and the next activity opens the picker', () => {
    const { cycle, phases } = start();
    cycle.sleepNow();
    expect(phases).toEqual(['idle']);
    vi.advanceTimersByTime(10 * 60_000);
    expect(phases).toEqual(['idle']);
    cycle.poke();
    expect(phases).toEqual(['idle', 'picker']);
    cycle.sleepNow();
    expect(phases).toEqual(['idle', 'picker', 'idle']);
  });

  it('activity while active restarts the idle clock', () => {
    const { cycle, phases } = start();
    vi.advanceTimersByTime(100_000);
    cycle.poke();
    vi.advanceTimersByTime(100_000);
    expect(phases).toEqual([]);
    vi.advanceTimersByTime(20_000);
    expect(phases).toEqual(['idle']);
  });

  it('never leaves active when the fade is off, as on a phone', () => {
    const { cycle, phases } = start(null);
    cycle.poke();
    vi.advanceTimersByTime(24 * 60 * 60 * 1000);
    cycle.poke();
    cycle.choose();
    expect(phases).toEqual([]);
  });

  it('suspension pins the cycle to active and stops the clocks, as with Admin open', () => {
    const { cycle, phases } = start();
    vi.advanceTimersByTime(120_000);
    cycle.poke();
    expect(phases).toEqual(['idle', 'picker']);
    cycle.setSuspended(true);
    expect(phases).toEqual(['idle', 'picker', 'active']);
    vi.advanceTimersByTime(10 * 60_000);
    cycle.poke();
    expect(phases).toEqual(['idle', 'picker', 'active']);
    cycle.setSuspended(false);
    vi.advanceTimersByTime(120_000);
    expect(phases).toEqual(['idle', 'picker', 'active', 'idle']);
  });

  it('stops on dispose', () => {
    const { cycle, phases } = start();
    cycle.dispose();
    vi.advanceTimersByTime(120_000);
    expect(phases).toEqual([]);
  });
});
