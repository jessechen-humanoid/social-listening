import { describe, expect, it } from 'vitest';
import { computeQuadrantCounts } from '../../components/ScatterPlot';
import { applyJitter } from '../jitter';

// Spec "Quadrant statistics computed from unjittered scores": jitter may push
// a boundary-adjacent point across an axis visually, but the statistics must
// come from the raw scores — screen and export both call computeQuadrantCounts
// on the same raw arrays, so their percentages are identical by construction.
describe('quadrant statistics from unjittered scores', () => {
  const rawPoints = [
    { x: 4.8, y: 5.1 },
    { x: 4.8, y: 5.1 },
    { x: 5.1, y: 4.8 },
  ];

  it('jitter can cross the axis for boundary points (why raw matters)', () => {
    let crossed = false;
    for (let rowIndex = 0; rowIndex < 200; rowIndex++) {
      const { jx } = applyJitter(4.8, 5.1, rowIndex);
      if (jx >= 5.0) crossed = true;
    }
    expect(crossed).toBe(true);
  });

  it('raw-score counts are deterministic and identical for screen and export inputs', () => {
    const screenInput = rawPoints.map((p) => ({ x: p.x, y: p.y }));
    const exportInput = rawPoints.map((p) => ({ x: p.x, y: p.y }));
    expect(computeQuadrantCounts(screenInput)).toEqual(computeQuadrantCounts(exportInput));
    // 4.8/5.1 → upper-left twice; 5.1/4.8 → lower-right once.
    expect(computeQuadrantCounts(screenInput)).toEqual([2, 0, 0, 1]);
  });
});
