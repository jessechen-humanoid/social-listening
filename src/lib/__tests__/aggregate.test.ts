import { describe, expect, it } from 'vitest';
import { engagementWeight } from '../engagement-weight';
import { computePlatformAggregate } from '../deep-pipeline/aggregate';

// Spec "Engagement-weighted quadrant aggregation" — weight table example.
describe('engagementWeight', () => {
  it.each([
    [null, 1.0],
    [0, 1.0],
    [3, 2.0],
    [99, 10.0],
  ])('engagementWeight(%j) → %d', (input, expected) => {
    expect(engagementWeight(input as number | null)).toBeCloseTo(expected, 10);
  });
});

describe('computePlatformAggregate', () => {
  it('weights engagement=99 as 10 and engagement=0 as 1 in the same quadrant', () => {
    const agg = computePlatformAggregate('fb', [
      { favor_calibrated: 8, emotion_calibrated: 8, engagement_value: 99, posted_at: null },
      { favor_calibrated: 8, emotion_calibrated: 8, engagement_value: 0, posted_at: null },
    ]);
    expect(agg.total_weight).toBeCloseTo(11, 10);
    expect(agg.quadrants.tr).toBeCloseTo(100, 10);
    expect(agg.sample_count).toBe(2);
  });

  it('counts zero- and NULL-engagement rows instead of dropping them', () => {
    const rows = Array.from({ length: 500 }, (_, i) => ({
      favor_calibrated: 7,
      emotion_calibrated: 7,
      engagement_value: i % 2 === 0 ? 0 : null,
      posted_at: null,
    }));
    const agg = computePlatformAggregate('fb', rows);
    expect(agg.sample_count).toBe(500);
    expect(agg.total_weight).toBeCloseTo(500, 10);
  });

  // Spec "Weekly timeline aggregation" — on-axis rows excluded from both sides,
  // including when pg returns NUMERIC as a string.
  it('keeps favor exactly 5 (even as a string) out of weekly pos/neg but in sample count', () => {
    const agg = computePlatformAggregate('fb', [
      {
        favor_calibrated: '5' as unknown as number,
        emotion_calibrated: '6' as unknown as number,
        engagement_value: 4,
        posted_at: '2026-04-08T12:00:00+08:00',
      },
      {
        favor_calibrated: '7' as unknown as number,
        emotion_calibrated: '6' as unknown as number,
        engagement_value: 3,
        posted_at: '2026-04-08T12:00:00+08:00',
      },
    ]);
    expect(agg.sample_count).toBe(2);
    expect(agg.weekly_buckets).toHaveLength(1);
    // Only the favor=7 row (weight 2) contributes; the on-axis row is on neither side.
    expect(agg.weekly_buckets[0].positive_weight).toBeCloseTo(2, 10);
    expect(agg.weekly_buckets[0].negative_weight).toBeCloseTo(0, 10);
    // On-axis row is also outside every quadrant.
    const q = agg.quadrants;
    expect(q.tr + q.tl + q.bl + q.br).toBeCloseTo(100, 5);
  });

  it('computes the weighted centroid', () => {
    const agg = computePlatformAggregate('fb', [
      { favor_calibrated: 7, emotion_calibrated: 7, engagement_value: 0, posted_at: null },
      { favor_calibrated: 7, emotion_calibrated: 7, engagement_value: 99, posted_at: null },
    ]);
    expect(agg.weighted_avg_favor).toBeCloseTo(7.0, 10);
  });
});
