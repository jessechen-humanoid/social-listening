import { describe, expect, it } from 'vitest';
import { applyJitter, JITTER_CLAMP, JITTER_SIGMA } from '../jitter';

// Spec "Gaussian jitter on data points" (MODIFIED: score-domain clamp).
describe('applyJitter', () => {
  it('clamps output into the score domain [0, 10]', () => {
    for (let i = 0; i < 500; i++) {
      const hi = applyJitter(10, 0, i);
      expect(hi.jx).toBeLessThanOrEqual(10);
      expect(hi.jy).toBeGreaterThanOrEqual(0);
      const lo = applyJitter(0, 10, i);
      expect(lo.jx).toBeGreaterThanOrEqual(0);
      expect(lo.jy).toBeLessThanOrEqual(10);
    }
  });

  it('stays within ±JITTER_CLAMP of the original score', () => {
    for (let i = 0; i < 500; i++) {
      const { jx, jy } = applyJitter(5, 5, i);
      expect(Math.abs(jx - 5)).toBeLessThanOrEqual(JITTER_CLAMP);
      expect(Math.abs(jy - 5)).toBeLessThanOrEqual(JITTER_CLAMP);
    }
  });

  it('is deterministic for the same row index', () => {
    const a = applyJitter(7, 8, 42);
    const b = applyJitter(7, 8, 42);
    expect(a).toEqual(b);
    // Different rows land differently (visual separation).
    const c = applyJitter(7, 8, 43);
    expect(c).not.toEqual(a);
  });

  it('named constants carry the spec values', () => {
    expect(JITTER_SIGMA).toBe(0.12);
    expect(JITTER_CLAMP).toBe(0.4);
  });
});
