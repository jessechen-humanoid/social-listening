import { v4 as uuidv4 } from 'uuid';
import { query } from './db';

// ---------------------------------------------------------------------------
// Quantile mapping
// ---------------------------------------------------------------------------

export interface QuantileMappingFn {
  // Anchor points sorted ascending by `quantiles[i]`.
  // `quantiles[i]` is the new-model raw score at the i-th percentile of the
  // calibration set. `golden_values[i]` is the corresponding golden score
  // at the same percentile rank. Linear interpolation between adjacent points.
  quantiles: number[];
  golden_values: number[];
}

const ANCHOR_COUNT = 101; // 0th, 1st, ..., 100th percentile

// Sort and pick 101 anchor points evenly across an array's quantiles.
function sampleAnchors(values: number[]): number[] {
  const sorted = values.slice().sort((a, b) => a - b);
  const anchors: number[] = [];
  for (let i = 0; i < ANCHOR_COUNT; i++) {
    const pos = (sorted.length - 1) * (i / (ANCHOR_COUNT - 1));
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    if (lo === hi) anchors.push(sorted[lo]);
    else anchors.push(sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo));
  }
  return anchors;
}

// Build a quantile mapping from new-model raw scores to golden scores.
// Length of inputs must match. Both arrays correspond to the same posts in
// the calibration set, in the same order.
export function fitQuantileMapping(
  rawScores: number[],
  goldenScores: number[]
): QuantileMappingFn {
  if (rawScores.length !== goldenScores.length) {
    throw new Error('fitQuantileMapping: input arrays must have the same length');
  }
  if (rawScores.length === 0) {
    throw new Error('fitQuantileMapping: input arrays must not be empty');
  }
  return {
    quantiles: sampleAnchors(rawScores),
    golden_values: sampleAnchors(goldenScores),
  };
}

// Apply the mapping to a single raw score via linear interpolation between
// the two surrounding anchor points. Out-of-range inputs clamp to the endpoint.
export function applyQuantileMapping(
  mapping: QuantileMappingFn,
  raw: number
): number {
  const { quantiles, golden_values } = mapping;
  if (quantiles.length === 0) return raw;
  if (raw <= quantiles[0]) return golden_values[0];
  if (raw >= quantiles[quantiles.length - 1]) return golden_values[golden_values.length - 1];

  // Binary search the surrounding pair
  let lo = 0;
  let hi = quantiles.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (quantiles[mid] <= raw) lo = mid;
    else hi = mid;
  }
  const span = quantiles[hi] - quantiles[lo];
  const t = span === 0 ? 0 : (raw - quantiles[lo]) / span;
  return golden_values[lo] + (golden_values[hi] - golden_values[lo]) * t;
}

// Mean absolute error between calibrated and golden — useful for logging fit quality.
export function computeMAE(
  rawScores: number[],
  goldenScores: number[],
  mapping: QuantileMappingFn
): number {
  let sum = 0;
  for (let i = 0; i < rawScores.length; i++) {
    sum += Math.abs(applyQuantileMapping(mapping, rawScores[i]) - goldenScores[i]);
  }
  return sum / rawScores.length;
}

// ---------------------------------------------------------------------------
// Spearman rank correlation
// ---------------------------------------------------------------------------

// Average-rank assignment to handle ties.
function rankWithTies(values: number[]): number[] {
  const indexed = values.map((v, i) => ({ v, i }));
  indexed.sort((a, b) => a.v - b.v);

  const ranks = new Array<number>(values.length);
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j + 1 < indexed.length && indexed[j + 1].v === indexed[i].v) j++;
    const avg = (i + j) / 2 + 1; // ranks are 1-indexed
    for (let k = i; k <= j; k++) ranks[indexed[k].i] = avg;
    i = j + 1;
  }
  return ranks;
}

// Spearman rank correlation between two equal-length arrays.
// Returns null if either array is empty or constant.
export function computeSpearmanRank(a: number[], b: number[]): number | null {
  if (a.length !== b.length) {
    throw new Error('computeSpearmanRank: input arrays must have the same length');
  }
  if (a.length < 2) return null;

  const ra = rankWithTies(a);
  const rb = rankWithTies(b);

  const n = a.length;
  const meanA = ra.reduce((s, x) => s + x, 0) / n;
  const meanB = rb.reduce((s, x) => s + x, 0) / n;

  let num = 0;
  let denomA = 0;
  let denomB = 0;
  for (let i = 0; i < n; i++) {
    const da = ra[i] - meanA;
    const db = rb[i] - meanB;
    num += da * db;
    denomA += da * da;
    denomB += db * db;
  }
  if (denomA === 0 || denomB === 0) return null;
  return num / Math.sqrt(denomA * denomB);
}

// ---------------------------------------------------------------------------
// Calibration set / mapping persistence
// ---------------------------------------------------------------------------

export interface CalibrationSet {
  id: string;
  name: string;
  brand_id: string;
  golden_model: string;
  golden_prompt_version_id: string;
  post_count: number;
  locked: boolean;
  created_at: string;
}

export interface CalibrationPost {
  id: string;
  set_id: string;
  row_index: number;
  content: string;
  platform: string;
  engagement: number | null;
  golden_emotion: number;
  golden_favor: number;
}

export interface CalibrationMapping {
  id: string;
  set_id: string;
  new_model: string;
  new_prompt_version_id: string;
  rank_rho_emotion: number | null;
  rank_rho_favor: number | null;
  mapping_function_emotion: QuantileMappingFn | null;
  mapping_function_favor: QuantileMappingFn | null;
  mae_emotion: number | null;
  mae_favor: number | null;
  accepted: boolean;
  created_at: string;
}

export class CalibrationLockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CalibrationLockedError';
  }
}

export class CalibrationCoverageError extends Error {
  details: string[];
  constructor(message: string, details: string[]) {
    super(message);
    this.name = 'CalibrationCoverageError';
    this.details = details;
  }
}

export interface CreateCalibrationSetInput {
  name: string;
  brandId: string;
  goldenModel: string;
  goldenPromptVersionId: string;
  posts: Array<{
    content: string;
    platform: string;
    engagement: number | null;
    goldenEmotion: number;
    goldenFavor: number;
  }>;
}

export async function createCalibrationSet(
  input: CreateCalibrationSetInput
): Promise<CalibrationSet> {
  const id = uuidv4();
  await query('BEGIN');
  try {
    await query(
      `INSERT INTO calibration_sets
         (id, name, brand_id, golden_model, golden_prompt_version_id, post_count, locked)
       VALUES ($1, $2, $3, $4, $5, $6, FALSE)`,
      [id, input.name, input.brandId, input.goldenModel, input.goldenPromptVersionId, input.posts.length]
    );
    for (let i = 0; i < input.posts.length; i++) {
      const p = input.posts[i];
      await query(
        `INSERT INTO calibration_posts
           (id, set_id, row_index, content, platform, engagement, golden_emotion, golden_favor)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [uuidv4(), id, i, p.content, p.platform, p.engagement, p.goldenEmotion, p.goldenFavor]
      );
    }
    await query('COMMIT');
  } catch (err) {
    await query('ROLLBACK');
    throw err;
  }
  return (await getCalibrationSet(id)) as CalibrationSet;
}

export async function getCalibrationSet(id: string): Promise<CalibrationSet | null> {
  const result = await query(
    `SELECT id, name, brand_id, golden_model, golden_prompt_version_id,
            post_count, locked, created_at
     FROM calibration_sets WHERE id = $1`,
    [id]
  );
  return (result.rows[0] as CalibrationSet | undefined) ?? null;
}

export async function getCalibrationPosts(setId: string): Promise<CalibrationPost[]> {
  const result = await query(
    `SELECT id, set_id, row_index, content, platform, engagement,
            golden_emotion, golden_favor
     FROM calibration_posts WHERE set_id = $1 ORDER BY row_index`,
    [setId]
  );
  return result.rows as CalibrationPost[];
}

const REQUIRED_PLATFORMS = ['fb', 'ig', 'threads', 'dcard'];
const MIN_POSTS_PER_INTEGER_BUCKET = 15;

// Validates coverage and locks the set. Caller must own admin privilege.
export async function lockCalibrationSet(setId: string): Promise<CalibrationSet> {
  const set = await getCalibrationSet(setId);
  if (!set) throw new Error(`Calibration set ${setId} not found`);
  if (set.locked) return set;

  const posts = await getCalibrationPosts(setId);
  const issues: string[] = [];

  // Coverage: each integer bucket 0..10 has ≥ 15 posts on each axis
  for (let bucket = 0; bucket <= 10; bucket++) {
    const emotionCount = posts.filter((p) => Math.round(p.golden_emotion) === bucket).length;
    const favorCount = posts.filter((p) => Math.round(p.golden_favor) === bucket).length;
    if (emotionCount < MIN_POSTS_PER_INTEGER_BUCKET) {
      issues.push(`emotion bucket ${bucket}: ${emotionCount}/${MIN_POSTS_PER_INTEGER_BUCKET}`);
    }
    if (favorCount < MIN_POSTS_PER_INTEGER_BUCKET) {
      issues.push(`favor bucket ${bucket}: ${favorCount}/${MIN_POSTS_PER_INTEGER_BUCKET}`);
    }
  }

  // Coverage: at least one post from each of the 4 platforms
  const platforms = new Set(posts.map((p) => p.platform));
  for (const p of REQUIRED_PLATFORMS) {
    if (!platforms.has(p)) issues.push(`missing platform: ${p}`);
  }

  if (issues.length > 0) {
    throw new CalibrationCoverageError('Calibration set coverage incomplete', issues);
  }

  await query(`UPDATE calibration_sets SET locked = TRUE WHERE id = $1`, [setId]);
  return { ...set, locked: true };
}

// Reject golden score edits on locked sets at the application layer.
export async function updateGoldenScore(
  postId: string,
  emotion: number,
  favor: number
): Promise<void> {
  const result = await query(
    `SELECT cs.locked FROM calibration_posts cp
     JOIN calibration_sets cs ON cs.id = cp.set_id
     WHERE cp.id = $1`,
    [postId]
  );
  const locked = (result.rows[0] as { locked?: boolean } | undefined)?.locked;
  if (locked) {
    throw new CalibrationLockedError(
      `Cannot edit golden scores on locked calibration set (post ${postId})`
    );
  }
  await query(
    `UPDATE calibration_posts SET golden_emotion = $1, golden_favor = $2 WHERE id = $3`,
    [emotion, favor, postId]
  );
}

// Gate result for a proposed model+prompt switch.
export type GateOutcome = 'block' | 'warn' | 'pass';

export interface CalibrationGateResult {
  outcome: GateOutcome;
  rho_emotion: number | null;
  rho_favor: number | null;
  message: string;
}

export function evaluateRankCorrelationGate(
  rhoEmotion: number | null,
  rhoFavor: number | null
): CalibrationGateResult {
  if (rhoEmotion === null || rhoFavor === null) {
    return {
      outcome: 'block',
      rho_emotion: rhoEmotion,
      rho_favor: rhoFavor,
      message: 'Rank correlation could not be computed (insufficient variance).',
    };
  }
  const minRho = Math.min(rhoEmotion, rhoFavor);
  if (minRho < 0.7) {
    return {
      outcome: 'block',
      rho_emotion: rhoEmotion,
      rho_favor: rhoFavor,
      message: `Rank disagreement too high (min ρ = ${minRho.toFixed(3)} < 0.7). Switch blocked.`,
    };
  }
  if (minRho < 0.85) {
    return {
      outcome: 'warn',
      rho_emotion: rhoEmotion,
      rho_favor: rhoFavor,
      message: `Rank correlation moderate (min ρ = ${minRho.toFixed(3)}). Switch allowed with warning.`,
    };
  }
  return {
    outcome: 'pass',
    rho_emotion: rhoEmotion,
    rho_favor: rhoFavor,
    message: `Rank correlation high (min ρ = ${minRho.toFixed(3)}). Switch accepted.`,
  };
}

// Build and persist a calibration mapping for (set, new_model, new_prompt_version).
// Caller must have already scored the calibration_posts with the new model and
// pass in matched arrays (same order as calibration_posts.row_index).
//
// Per spec: this guards against calibration stacking by always reading the
// golden scores from calibration_posts (which equal the golden_model's output
// at the time of set creation), never from any prior new-model mapping.
export async function recordCalibrationMapping(input: {
  setId: string;
  newModel: string;
  newPromptVersionId: string;
  newRawEmotion: number[];
  newRawFavor: number[];
}): Promise<CalibrationMapping> {
  const set = await getCalibrationSet(input.setId);
  if (!set) throw new Error(`Calibration set ${input.setId} not found`);
  const posts = await getCalibrationPosts(input.setId);

  if (
    input.newRawEmotion.length !== posts.length ||
    input.newRawFavor.length !== posts.length
  ) {
    throw new Error(
      `Score arrays length ${input.newRawEmotion.length}/${input.newRawFavor.length} ` +
        `does not match calibration set size ${posts.length}`
    );
  }

  const goldenEmotion = posts.map((p) => Number(p.golden_emotion));
  const goldenFavor = posts.map((p) => Number(p.golden_favor));

  const rhoEmotion = computeSpearmanRank(input.newRawEmotion, goldenEmotion);
  const rhoFavor = computeSpearmanRank(input.newRawFavor, goldenFavor);
  const gate = evaluateRankCorrelationGate(rhoEmotion, rhoFavor);

  let mappingEmotion: QuantileMappingFn | null = null;
  let mappingFavor: QuantileMappingFn | null = null;
  let maeEmotion: number | null = null;
  let maeFavor: number | null = null;

  if (gate.outcome !== 'block') {
    mappingEmotion = fitQuantileMapping(input.newRawEmotion, goldenEmotion);
    mappingFavor = fitQuantileMapping(input.newRawFavor, goldenFavor);
    maeEmotion = computeMAE(input.newRawEmotion, goldenEmotion, mappingEmotion);
    maeFavor = computeMAE(input.newRawFavor, goldenFavor, mappingFavor);
  }

  const id = uuidv4();
  await query(
    `INSERT INTO calibration_mappings
       (id, set_id, new_model, new_prompt_version_id,
        rank_rho_emotion, rank_rho_favor,
        mapping_function_emotion, mapping_function_favor,
        mae_emotion, mae_favor, accepted)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, FALSE)
     ON CONFLICT (set_id, new_model, new_prompt_version_id)
     DO UPDATE SET
       rank_rho_emotion = EXCLUDED.rank_rho_emotion,
       rank_rho_favor = EXCLUDED.rank_rho_favor,
       mapping_function_emotion = EXCLUDED.mapping_function_emotion,
       mapping_function_favor = EXCLUDED.mapping_function_favor,
       mae_emotion = EXCLUDED.mae_emotion,
       mae_favor = EXCLUDED.mae_favor`,
    [
      id,
      input.setId,
      input.newModel,
      input.newPromptVersionId,
      rhoEmotion,
      rhoFavor,
      mappingEmotion ? JSON.stringify(mappingEmotion) : null,
      mappingFavor ? JSON.stringify(mappingFavor) : null,
      maeEmotion,
      maeFavor,
    ]
  );
  const fetched = await query(
    `SELECT id, set_id, new_model, new_prompt_version_id,
            rank_rho_emotion, rank_rho_favor,
            mapping_function_emotion, mapping_function_favor,
            mae_emotion, mae_favor, accepted, created_at
     FROM calibration_mappings WHERE set_id = $1 AND new_model = $2 AND new_prompt_version_id = $3`,
    [input.setId, input.newModel, input.newPromptVersionId]
  );
  return fetched.rows[0] as CalibrationMapping;
}

// Lookup a mapping for a (calibration_set, new_model, prompt_version) triple.
// Returns null if none — caller should treat calibrated = raw in that case.
export async function getCalibrationMapping(
  setId: string,
  newModel: string,
  newPromptVersionId: string
): Promise<CalibrationMapping | null> {
  const result = await query(
    `SELECT id, set_id, new_model, new_prompt_version_id,
            rank_rho_emotion, rank_rho_favor,
            mapping_function_emotion, mapping_function_favor,
            mae_emotion, mae_favor, accepted, created_at
     FROM calibration_mappings
     WHERE set_id = $1 AND new_model = $2 AND new_prompt_version_id = $3`,
    [setId, newModel, newPromptVersionId]
  );
  return (result.rows[0] as CalibrationMapping | undefined) ?? null;
}

// Apply calibration to a task's stored raw scores.
// Called by the orchestrator after AI stages complete.
// If the brand has no calibration_set or no mapping for the task's
// (model, prompt_version) combo, calibrated := raw (identity).
export async function applyTaskCalibration(taskId: string): Promise<void> {
  const taskRow = await query(
    `SELECT t.brand_id, b.calibration_set_id
     FROM tasks t LEFT JOIN brands b ON b.id = t.brand_id
     WHERE t.task_id = $1`,
    [taskId]
  );
  const calibrationSetId = (
    taskRow.rows[0] as { calibration_set_id?: string | null } | undefined
  )?.calibration_set_id;

  if (!calibrationSetId) {
    // Identity calibration
    await query(
      `UPDATE task_results
       SET emotion_calibrated = emotion_raw, favor_calibrated = favor_raw
       WHERE task_id = $1 AND emotion_raw IS NOT NULL`,
      [taskId]
    );
    return;
  }

  // Determine the (model, prompt_version) for each stage on this task. Use the
  // A_emotion_favor binding as the canonical "scoring model" since all comment
  // stages share the same model_snapshot in v1 seed data.
  const bindings = await query(
    `SELECT pb.stage_name, pv.model_snapshot, pb.prompt_version_id
     FROM task_prompt_bindings pb
     JOIN prompt_versions pv ON pv.id = pb.prompt_version_id
     WHERE pb.task_id = $1`,
    [taskId]
  );
  const aEmotion = (bindings.rows as Array<{
    stage_name: string;
    model_snapshot: string;
    prompt_version_id: string;
  }>).find((r) => r.stage_name === 'A_emotion_favor');

  if (!aEmotion) {
    await query(
      `UPDATE task_results
       SET emotion_calibrated = emotion_raw, favor_calibrated = favor_raw
       WHERE task_id = $1 AND emotion_raw IS NOT NULL`,
      [taskId]
    );
    return;
  }

  const mapping = await getCalibrationMapping(
    calibrationSetId,
    aEmotion.model_snapshot,
    aEmotion.prompt_version_id
  );

  if (
    !mapping ||
    !mapping.mapping_function_emotion ||
    !mapping.mapping_function_favor
  ) {
    await query(
      `UPDATE task_results
       SET emotion_calibrated = emotion_raw, favor_calibrated = favor_raw
       WHERE task_id = $1 AND emotion_raw IS NOT NULL`,
      [taskId]
    );
    return;
  }

  const rows = await query(
    `SELECT result_id, emotion_raw, favor_raw
     FROM task_results
     WHERE task_id = $1 AND emotion_raw IS NOT NULL`,
    [taskId]
  );

  for (const row of rows.rows as Array<{
    result_id: string;
    emotion_raw: number | null;
    favor_raw: number | null;
  }>) {
    const emotionCal =
      row.emotion_raw !== null
        ? applyQuantileMapping(mapping.mapping_function_emotion, Number(row.emotion_raw))
        : null;
    const favorCal =
      row.favor_raw !== null
        ? applyQuantileMapping(mapping.mapping_function_favor, Number(row.favor_raw))
        : null;
    await query(
      `UPDATE task_results SET emotion_calibrated = $1, favor_calibrated = $2 WHERE result_id = $3`,
      [emotionCal, favorCal, row.result_id]
    );
  }
}
