import { query } from '../db';

interface ScoredRow {
  emotion_calibrated: number | null;
  favor_calibrated: number | null;
  engagement_value: number | null;
  posted_at: Date | string | null;
}

export interface QuadrantPct {
  tr: number; // top-right: favor > 5, emotion > 5
  tl: number; // top-left: favor < 5, emotion > 5
  bl: number; // bottom-left: favor < 5, emotion < 5
  br: number; // bottom-right: favor > 5, emotion < 5
}

export interface WeeklyBucket {
  week_start: string; // YYYY-MM-DD (Monday of ISO week)
  positive_weight: number;
  negative_weight: number;
}

export interface PlatformAggregate {
  platform: string;
  weighted_avg_favor: number | null;
  weighted_avg_emotion: number | null;
  total_weight: number;
  sample_count: number;
  quadrants: QuadrantPct;
  weekly_buckets: WeeklyBucket[];
}

const AXIS_MID = 5;

function sqrtEng(v: number | null): number {
  const n = v ?? 0;
  return n > 0 ? Math.sqrt(n) : 0;
}

// Format a Date as the Monday of its ISO week, YYYY-MM-DD.
function isoWeekStart(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - (day - 1));
  return date.toISOString().slice(0, 10);
}

export function computePlatformAggregate(
  platform: string,
  rows: ScoredRow[]
): PlatformAggregate {
  let totalWeight = 0;
  let weightedFavor = 0;
  let weightedEmotion = 0;
  const quadrantWeights = { tr: 0, tl: 0, bl: 0, br: 0 };
  const weekly = new Map<string, { pos: number; neg: number }>();

  let sample = 0;
  for (const r of rows) {
    const favor = r.favor_calibrated;
    const emotion = r.emotion_calibrated;
    if (favor === null || emotion === null) continue;
    const w = sqrtEng(r.engagement_value);
    if (w === 0) continue;

    sample++;
    totalWeight += w;
    weightedFavor += favor * w;
    weightedEmotion += emotion * w;

    if (favor > AXIS_MID && emotion > AXIS_MID) quadrantWeights.tr += w;
    else if (favor < AXIS_MID && emotion > AXIS_MID) quadrantWeights.tl += w;
    else if (favor < AXIS_MID && emotion < AXIS_MID) quadrantWeights.bl += w;
    else if (favor > AXIS_MID && emotion < AXIS_MID) quadrantWeights.br += w;
    // favor == 5 or emotion == 5: on axis, excluded from quadrant pct

    if (favor !== AXIS_MID && r.posted_at) {
      const dt = r.posted_at instanceof Date ? r.posted_at : new Date(r.posted_at);
      if (!Number.isNaN(dt.getTime())) {
        const wk = isoWeekStart(dt);
        if (!weekly.has(wk)) weekly.set(wk, { pos: 0, neg: 0 });
        const bucket = weekly.get(wk)!;
        if (favor > AXIS_MID) bucket.pos += w;
        else bucket.neg += w;
      }
    }
  }

  const quadrants: QuadrantPct =
    totalWeight > 0
      ? {
          tr: (quadrantWeights.tr / totalWeight) * 100,
          tl: (quadrantWeights.tl / totalWeight) * 100,
          bl: (quadrantWeights.bl / totalWeight) * 100,
          br: (quadrantWeights.br / totalWeight) * 100,
        }
      : { tr: 0, tl: 0, bl: 0, br: 0 };

  const weeklyBuckets: WeeklyBucket[] = Array.from(weekly.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week_start, v]) => ({
      week_start,
      positive_weight: v.pos,
      negative_weight: v.neg,
    }));

  return {
    platform,
    weighted_avg_favor: totalWeight > 0 ? weightedFavor / totalWeight : null,
    weighted_avg_emotion: totalWeight > 0 ? weightedEmotion / totalWeight : null,
    total_weight: totalWeight,
    sample_count: sample,
    quadrants,
    weekly_buckets: weeklyBuckets,
  };
}

// Build aggregates for every platform represented in this task's results
// and persist them. Excludes filtered_out and not_real_user rows.
export async function aggregateDeepTask(taskId: string): Promise<PlatformAggregate[]> {
  const rows = await query(
    `SELECT platform, emotion_calibrated, favor_calibrated, engagement_value, posted_at
     FROM task_results
     WHERE task_id = $1
       AND COALESCE(filtered_out, FALSE) = FALSE
       AND COALESCE(not_real_user, FALSE) = FALSE
       AND emotion_calibrated IS NOT NULL
       AND favor_calibrated IS NOT NULL`,
    [taskId]
  );

  const byPlatform = new Map<string, ScoredRow[]>();
  for (const r of rows.rows as Array<ScoredRow & { platform: string }>) {
    const list = byPlatform.get(r.platform) ?? [];
    list.push(r);
    byPlatform.set(r.platform, list);
  }

  const results: PlatformAggregate[] = [];
  for (const [platform, list] of byPlatform) {
    const agg = computePlatformAggregate(platform, list);
    results.push(agg);
    await query(
      `INSERT INTO deep_task_aggregates
         (task_id, platform, weighted_avg_favor, weighted_avg_emotion,
          total_weight, sample_count,
          quadrant_tr_pct, quadrant_tl_pct, quadrant_bl_pct, quadrant_br_pct,
          weekly_buckets)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (task_id, platform) DO UPDATE SET
         weighted_avg_favor = EXCLUDED.weighted_avg_favor,
         weighted_avg_emotion = EXCLUDED.weighted_avg_emotion,
         total_weight = EXCLUDED.total_weight,
         sample_count = EXCLUDED.sample_count,
         quadrant_tr_pct = EXCLUDED.quadrant_tr_pct,
         quadrant_tl_pct = EXCLUDED.quadrant_tl_pct,
         quadrant_bl_pct = EXCLUDED.quadrant_bl_pct,
         quadrant_br_pct = EXCLUDED.quadrant_br_pct,
         weekly_buckets = EXCLUDED.weekly_buckets`,
      [
        taskId,
        platform,
        agg.weighted_avg_favor,
        agg.weighted_avg_emotion,
        agg.total_weight,
        agg.sample_count,
        agg.quadrants.tr,
        agg.quadrants.tl,
        agg.quadrants.bl,
        agg.quadrants.br,
        JSON.stringify(agg.weekly_buckets),
      ]
    );
  }

  return results;
}

export async function getDeepTaskAggregates(taskId: string): Promise<PlatformAggregate[]> {
  const rows = await query(
    `SELECT platform, weighted_avg_favor, weighted_avg_emotion,
            total_weight, sample_count,
            quadrant_tr_pct, quadrant_tl_pct, quadrant_bl_pct, quadrant_br_pct,
            weekly_buckets
     FROM deep_task_aggregates WHERE task_id = $1`,
    [taskId]
  );
  return (rows.rows as Array<{
    platform: string;
    weighted_avg_favor: number | null;
    weighted_avg_emotion: number | null;
    total_weight: number;
    sample_count: number;
    quadrant_tr_pct: number;
    quadrant_tl_pct: number;
    quadrant_bl_pct: number;
    quadrant_br_pct: number;
    weekly_buckets: WeeklyBucket[] | null;
  }>).map((r) => ({
    platform: r.platform,
    weighted_avg_favor: r.weighted_avg_favor,
    weighted_avg_emotion: r.weighted_avg_emotion,
    total_weight: Number(r.total_weight),
    sample_count: r.sample_count,
    quadrants: {
      tr: Number(r.quadrant_tr_pct),
      tl: Number(r.quadrant_tl_pct),
      bl: Number(r.quadrant_bl_pct),
      br: Number(r.quadrant_br_pct),
    },
    weekly_buckets: r.weekly_buckets ?? [],
  }));
}
