export interface UploadedFile {
  id: string;
  file: File;
  filename: string;
  columns: string[];
  rowCount: number;
  contentColumn: string;
  engagementColumn: string;
  data: Record<string, unknown>[];
}

export interface AnalysisConfig {
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
}
