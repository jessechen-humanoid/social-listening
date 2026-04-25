import type { FileRole } from './column-mapping';
import type { Platform } from './platforms';

export interface UploadedFile {
  id: string;
  file: File;
  filename: string;
  columns: string[];
  rowCount: number;
  contentColumn: string;
  engagementColumn: string;
  data: Record<string, unknown>[];
  // Deep mode: which role slot this file occupies. Undefined for light mode.
  role?: FileRole;
}

// Light mode (existing) — Brand or Custom analysis with user-defined axes.
export interface LightAnalysisConfig {
  mode: 'brand' | 'custom';
  projectName: string;
  conditionText: string;
  conditionFilterEnabled: boolean;
  xAxis: AxisConfig;
  yAxis: AxisConfig;
  model: string;
  dotColor: string;
  maxRows: number;
}

// Deep mode — locked axes (Favor × Emotion), brand-bound, multi-stage pipeline.
export interface DeepAnalysisConfig {
  mode: 'deep';
  projectName: string;
  brandId: string;
  brandName: string;
  platform: Platform;
  timeRangeStart: string; // YYYY-MM-DD
  timeRangeEnd: string;
  // Optional per-stage overrides; otherwise the brand's active prompts are used
  promptVersionOverrides?: Record<string, string>;
}

// Backward-compatible alias used by existing components / API.
// Existing code references `AnalysisConfig` and assumes the light shape;
// keep that shape exported under the same name to avoid breaking light mode.
export type AnalysisConfig = LightAnalysisConfig;

export interface BrandSummary {
  id: string;
  name: string;
  calibration_set_id: string | null;
}

export interface PromptVersionSummary {
  id: string;
  stage_name: string;
  version_label: string;
  model_snapshot: string;
  active: boolean;
}

export interface CalibrationSetSummary {
  id: string;
  name: string;
  brand_id: string;
  golden_model: string;
  locked: boolean;
}

export interface AxisConfig {
  name: string;
  zeroDescription: string;
  tenDescription: string;
}

export interface TaskResult {
  result_id: string;
  task_id: string;
  file_id: string;
  row_index: number;
  content_text: string;
  condition_result: boolean | null;
  x_score: number | null;
  y_score: number | null;
  reasoning: string | null;
  engagement_value: number | null;
  status: string;
  source_file?: string;
}

export interface TaskProgress {
  task_id: string;
  status: string;
  total_items: number;
  completed_items: number;
  percentage: number;
  config: AnalysisConfig;
  created_at: string;
  mode?: 'light' | 'deep';
  stages?: Array<{
    stage_name: string;
    status: string;
    input_count: number;
    output_count: number;
    error: string | null;
  }>;
}
