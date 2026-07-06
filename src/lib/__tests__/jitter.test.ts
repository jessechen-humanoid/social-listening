import { describe, expect, it } from 'vitest';
import { applyJitter, JITTER_SIGMA } from '../jitter';
import { adaptiveAlpha, buildScatterPoints, pointRadius, SIZE_COEF_1000PX, TARGET_INK_PX2 } from '../../components/ScatterPlot';
import type { TaskResult } from '../types';

// Spec "Gaussian jitter on data points" (MODIFIED: σ=0.3 Python parity,
// no per-axis cap, score-domain clamp kept).
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

  it('disperses with σ ≈ 0.3 and keeps natural tails beyond 0.4', () => {
    const offsets: number[] = [];
    let beyondCap = 0;
    for (let i = 0; i < 2000; i++) {
      const { jx } = applyJitter(5, 5, i);
      const dx = jx - 5;
      offsets.push(dx);
      if (Math.abs(dx) > 0.4) beyondCap++;
    }
    const mean = offsets.reduce((a, b) => a + b, 0) / offsets.length;
    const std = Math.sqrt(offsets.reduce((a, b) => a + (b - mean) ** 2, 0) / offsets.length);
    // Sampled σ close to the spec value (loose tolerance for seeded sampling).
    expect(std).toBeGreaterThan(0.25);
    expect(std).toBeLessThan(0.35);
    // Gaussian tails exist: ~18% of |N(0, 0.3)| exceeds 0.4 — the old hard
    // cap is gone (spec scenario "Natural Gaussian tails are preserved").
    expect(beyondCap).toBeGreaterThan(100);
  });

  it('is deterministic for the same row index', () => {
    const a = applyJitter(7, 8, 42);
    const b = applyJitter(7, 8, 42);
    expect(a).toEqual(b);
    const c = applyJitter(7, 8, 43);
    expect(c).not.toEqual(a);
  });

  it('named constant carries the Python-parity value', () => {
    expect(JITTER_SIGMA).toBe(0.3);
  });
});

// Spec "Engagement-based point sizing" (MODIFIED: Python area-equivalent,
// absolute scale). Example-table values from the spec.
describe('pointRadius', () => {
  it.each([
    [0, 2.5],
    [100, 24.9],
    [10000, 45], // capped (spec example table)
  ])('engagement %d → ≈ %f px on the 1000px export', (engagement, expected) => {
    expect(pointRadius(engagement, 1000)).toBeCloseTo(expected, 0);
  });

  it('scales linearly with canvas width', () => {
    expect(pointRadius(100, 500)).toBeCloseTo(pointRadius(100, 1000) / 2, 5);
  });

  it('is absolute: batch composition does not change a point radius', () => {
    const row = (id: string, eng: number, idx: number): TaskResult =>
      ({
        result_id: id, task_id: 't', file_id: 'f', row_index: idx,
        content_text: '', condition_result: null,
        x_score: 5, y_score: 5, reasoning: null,
        engagement_value: eng, status: 'completed',
      }) as TaskResult;
    const opts = {
      weighted: false, conditionFilterEnabled: false, conditionText: '',
      platformAlpha: {}, canvasWidth: 1000,
    };
    const alone = buildScatterPoints([row('a', 100, 0)], opts);
    const withGiant = buildScatterPoints([row('a', 100, 0), row('b', 100000, 1)], opts);
    expect(withGiant[0].radius).toBeCloseTo(alone[0].radius, 8);
  });

  it('SIZE_COEF matches the matplotlib-equivalent constant', () => {
    expect(SIZE_COEF_1000PX).toBeCloseTo(Math.sqrt(100 / Math.PI) * (100 / 72), 6);
  });
});

// Spec "Deep scatter default styling" + "Platform transparency configurable
// per brand" (MODIFIED: density-adaptive default via ink conservation).
describe('adaptive platform alpha', () => {
  const deepRow = (platform: string, eng: number, idx: number): TaskResult =>
    ({
      result_id: `r${idx}`, task_id: 't', file_id: 'f', row_index: idx,
      content_text: '', condition_result: null,
      x_score: null, y_score: null, reasoning: null,
      engagement_value: eng, status: 'A_emotion_favor_done',
      favor_calibrated: 5, emotion_calibrated: 5, platform,
    }) as unknown as TaskResult;

  it('reproduces the legacy calibration anchor: Q1-like ink → alpha ≈ 0.1', () => {
    // Synthetic distribution with the same total ink as the Q1 Threads chart:
    // TARGET_INK / 0.1 spread over uniform radii.
    const n = 6225;
    const rEach = Math.sqrt(TARGET_INK_PX2 / 0.1 / n);
    expect(adaptiveAlpha(Array.from({ length: n }, () => rEach))).toBeCloseTo(0.1, 3);
  });

  it('doubling the ink halves the adaptive alpha', () => {
    const radii = Array.from({ length: 1000 }, () => 20); // ink 400k → both sides unclamped
    const a1 = adaptiveAlpha(radii);
    const a2 = adaptiveAlpha([...radii, ...radii]);
    expect(a2).toBeCloseTo(a1 / 2, 6);
  });

  it('clamps to the floor and ceiling', () => {
    expect(adaptiveAlpha(Array.from({ length: 200000 }, () => 50))).toBe(0.008);
    expect(adaptiveAlpha([1])).toBe(0.4);
  });

  it('a brand override for the platform wins over the adaptive default', () => {
    const rows = [deepRow('fb', 10, 0), deepRow('fb', 10, 1)];
    const opts = {
      weighted: true, conditionFilterEnabled: false, conditionText: '',
      canvasWidth: 1000,
    };
    const auto = buildScatterPoints(rows, { ...opts, platformAlpha: {} });
    const overridden = buildScatterPoints(rows, { ...opts, platformAlpha: { fb: 0.08 } });
    expect(overridden[0].alpha).toBe(0.08);
    expect(auto[0].alpha).not.toBe(0.08);
    expect(auto[0].alpha).toBe(auto[1].alpha);
  });
});
