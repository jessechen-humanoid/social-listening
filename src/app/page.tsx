"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import FileUpload from '@/components/FileUpload';
import AnalysisConfigPanel from '@/components/AnalysisConfig';
import DeepConfig from '@/components/DeepConfig';
import ColumnMappingStep, { type ConfirmedMappings } from '@/components/ColumnMappingStep';
import ScatterPlot, { exportScatterPlotPNG, computeQuadrantCounts } from '@/components/ScatterPlot';
import ProgressBar from '@/components/ProgressBar';
import WeeklyTimeline from '@/components/WeeklyTimeline';
import { exportReportCSV } from '@/lib/export-report';
import { getBrowserUuid } from '@/lib/browser-uuid';
import type {
  UploadedFile,
  AnalysisConfig,
  DeepAnalysisConfig,
  TaskResult,
  TaskProgress,
} from '@/lib/types';

const DEFAULT_CONFIG: AnalysisConfig = {
  mode: 'brand',
  projectName: '',
  conditionText: '',
  conditionFilterEnabled: false,
  xAxis: { name: '好感度', zeroDescription: '對品牌完全負面', tenDescription: '對品牌高度正面' },
  yAxis: { name: '情緒強度', zeroDescription: '平淡無情緒', tenDescription: '情緒非常激烈' },
  model: 'gpt-4o',
  dotColor: '#404040',
  maxRows: 0,
};

const DEFAULT_DEEP_CONFIG: DeepAnalysisConfig = {
  mode: 'deep',
  projectName: '',
  brandId: '',
  brandName: '',
  platform: 'fb',
  timeRangeStart: '',
  timeRangeEnd: '',
};

type ViewState = 'config' | 'deep-config' | 'deep-mapping' | 'processing' | 'results' | 'history';

export default function Home() {
  const [view, setView] = useState<ViewState>('config');
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [config, setConfig] = useState<AnalysisConfig>(DEFAULT_CONFIG);
  const [deepConfig, setDeepConfig] = useState<DeepAnalysisConfig>(DEFAULT_DEEP_CONFIG);
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);
  // Display config for viewing a historical task's results — kept separate
  // from the light form `config` so viewing a deep task (whose config has no
  // xAxis/yAxis) never pollutes or crashes the form state.
  const [viewConfig, setViewConfig] = useState<AnalysisConfig>(DEFAULT_CONFIG);
  const [progress, setProgress] = useState<TaskProgress | null>(null);
  const [results, setResults] = useState<TaskResult[]>([]);
  const [history, setHistory] = useState<TaskProgress[]>([]);
  const [browserUuid, setBrowserUuid] = useState('');
  // In-flight lock: creating a task uploads MBs of rows — double-clicks must
  // not create duplicate (expensive) tasks.
  const [submitting, setSubmitting] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Monotonic guard: rapid clicks on two history tasks must not interleave —
  // only the latest requested task may write result state.
  const viewSeqRef = useRef(0);

  // Initialize UUID — defer setState to avoid cascading effect render
  useEffect(() => {
    const id = setTimeout(() => setBrowserUuid(getBrowserUuid()), 0);
    return () => clearTimeout(id);
  }, []);

  // Fetch history
  const fetchHistory = useCallback(async () => {
    if (!browserUuid) return;
    try {
      const res = await fetch(`/api/tasks?browserUuid=${browserUuid}`);
      const data = await res.json();
      setHistory(data.tasks || []);

      // No longer auto-redirect to processing — history page shows progress inline
    } catch { /* ignore */ }
  }, [browserUuid, view]);

  useEffect(() => {
    if (!browserUuid) return;
    const id = setTimeout(() => { fetchHistory(); }, 0);
    return () => clearTimeout(id);
  }, [browserUuid, fetchHistory]);

  // Poll history when on history page and there are processing tasks
  useEffect(() => {
    if (view !== 'history') return;
    const hasProcessing = history.some(t => t.status === 'processing');
    if (!hasProcessing) return;

    pollingRef.current = setInterval(() => {
      fetchHistory();
    }, 3000);

    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [view, history, fetchHistory]);

  // Validate before submit
  const canSubmit = files.length > 0 && files.every(f => f.contentColumn !== '');
  const customValid = config.mode === 'custom'
    ? config.xAxis.name && config.yAxis.name
    : true;

  const handleStartAnalysis = async () => {
    if (!canSubmit || !customValid || submitting) return;
    setSubmitting(true);

    try {
      const payload = {
        browserUuid,
        mode: 'light',
        config,
        files: files.map(f => ({
          filename: f.filename,
          contentColumn: f.contentColumn,
          engagementColumn: f.engagementColumn || null,
          columnMapping: { content: f.contentColumn, engagement: f.engagementColumn || null },
          data: f.data,
        })),
      };

      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (data.task_id) {
        setFiles([]);
        setConfig(DEFAULT_CONFIG);
        fetchHistory();
        setView('history');
      } else {
        alert(data.error || '建立任務失敗');
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : '發生錯誤');
    } finally {
      setSubmitting(false);
    }
  };

  // Deep mode: validate config, then move to mapping step
  const canProceedToDeepMapping =
    !!deepConfig.brandId &&
    !!deepConfig.platform &&
    !!deepConfig.timeRangeStart &&
    !!deepConfig.timeRangeEnd &&
    files.length > 0 &&
    (deepConfig.platform !== 'fb' || files.length === 3);

  const handleStartDeepAnalysis = async (mappings: ConfirmedMappings) => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const filesPayload = files.map((f) => {
        const m = mappings.perFile.find((x) => x.fileId === f.id);
        return {
          filename: f.filename,
          role: f.role,
          columnMapping: m?.mapping ?? {},
          data: f.data,
          forumFilter:
            f.role === 'hotpost' && deepConfig.platform === 'dcard'
              ? mappings.forumFilter
              : null,
        };
      });

      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          browserUuid,
          mode: 'deep',
          config: deepConfig,
          files: filesPayload,
        }),
      });
      const data = await res.json();
      if (data.task_id) {
        setFiles([]);
        setDeepConfig(DEFAULT_DEEP_CONFIG);
        fetchHistory();
        setView('history');
      } else {
        alert(data.error ?? '建立深度任務失敗');
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : '發生錯誤');
    } finally {
      setSubmitting(false);
    }
  };

  const handleViewResult = async (taskId: string) => {
    const seq = ++viewSeqRef.current;
    setCurrentTaskId(taskId);
    try {
      const [progressRes, resultsRes] = await Promise.all([
        fetch(`/api/tasks/${taskId}/progress`),
        fetch(`/api/tasks/${taskId}/results`),
      ]);
      const [progressData, resultsData] = await Promise.all([
        progressRes.json(),
        resultsRes.json(),
      ]);
      if (seq !== viewSeqRef.current) return; // a newer click superseded this one

      setProgress(progressData);
      setResults(resultsData.results || []);

      // Deep task configs have no xAxis/yAxis — render them with fixed axis
      // names instead of pushing them into light-config-shaped state.
      if (progressData.mode === 'deep') {
        setViewConfig({
          ...DEFAULT_CONFIG,
          projectName:
            (progressData.config as unknown as DeepAnalysisConfig)?.projectName ?? '',
          xAxis: { ...DEFAULT_CONFIG.xAxis, name: '品牌好感度' },
          yAxis: { ...DEFAULT_CONFIG.yAxis, name: '情緒強度' },
        });
      } else {
        setViewConfig(progressData.config ?? DEFAULT_CONFIG);
      }

      if (progressData.status === 'processing' || progressData.status === 'pending') {
        setView('processing');
      } else {
        setView('results');
      }
    } catch { /* ignore */ }
  };

  // Poll the task being viewed while on the processing view; switch to the
  // results view once it completes. Interval is cleared on view change/unmount.
  useEffect(() => {
    if (view !== 'processing' || !currentTaskId) return;
    const taskId = currentTaskId;
    let cancelled = false;

    const id = setInterval(async () => {
      try {
        const res = await fetch(`/api/tasks/${taskId}/progress`);
        const data = await res.json();
        if (cancelled) return;
        setProgress(data);

        if (data.status === 'completed') {
          const resultsRes = await fetch(`/api/tasks/${taskId}/results`);
          const resultsData = await resultsRes.json();
          if (cancelled) return;
          setResults(resultsData.results || []);
          setView('results');
        } else if (data.status === 'error') {
          setView('history');
          fetchHistory();
        }
      } catch { /* transient network error — keep polling */ }
    }, 3000);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [view, currentTaskId, fetchHistory]);

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      {/* Header area with navigation */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: '#1a1a1a' }}>
            社群輿情分析
          </h1>
          <p className="text-sm mt-1" style={{ color: '#6b6b6b' }}>
            上傳社群資料，AI 自動分析好感度與情緒強度
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => { setView('config'); setCurrentTaskId(null); setResults([]); setFiles([]); setConfig(DEFAULT_CONFIG); }}
            className="px-3 py-1.5 rounded-lg text-sm font-medium transition"
            style={view === 'config' ? { backgroundColor: 'rgba(0,0,0,0.04)', color: '#1a1a1a' } : { color: '#6b6b6b' }}
          >
            輕度分析
          </button>
          <button
            onClick={() => { setView('deep-config'); setCurrentTaskId(null); setResults([]); setFiles([]); setDeepConfig(DEFAULT_DEEP_CONFIG); }}
            className="px-3 py-1.5 rounded-lg text-sm font-medium transition"
            style={view === 'deep-config' || view === 'deep-mapping' ? { backgroundColor: 'rgba(0,0,0,0.04)', color: '#1a1a1a' } : { color: '#6b6b6b' }}
          >
            深度分析
          </button>
          <button
            onClick={() => { setView('history'); fetchHistory(); }}
            className="px-3 py-1.5 rounded-lg text-sm font-medium transition"
            style={view === 'history' ? { backgroundColor: 'rgba(0,0,0,0.04)', color: '#1a1a1a' } : { color: '#6b6b6b' }}
          >
            歷史紀錄
          </button>
        </div>
      </div>

      {/* Deep config view */}
      {view === 'deep-config' && (
        <div className="space-y-6">
          <DeepConfig config={deepConfig} onChange={setDeepConfig} />
          <FileUpload
            files={files}
            onChange={setFiles}
            mode="deep"
            platform={deepConfig.platform}
          />
          <button
            onClick={() => setView('deep-mapping')}
            disabled={!canProceedToDeepMapping}
            className="w-full py-3 rounded-lg font-medium text-sm transition disabled:opacity-40"
            style={{ backgroundColor: '#1a1a1a', color: '#ffffff' }}
          >
            下一步：欄位對應
          </button>
        </div>
      )}

      {/* Deep mapping view */}
      {view === 'deep-mapping' && (
        <ColumnMappingStep
          files={files}
          platform={deepConfig.platform}
          onBack={() => setView('deep-config')}
          onConfirm={handleStartDeepAnalysis}
        />
      )}

      {/* Light config view */}
      {view === 'config' && (
        <div className="space-y-6">
          <AnalysisConfigPanel config={config} onChange={setConfig} totalRows={files.reduce((sum, f) => sum + f.rowCount, 0)} />
          <FileUpload files={files} onChange={setFiles} />

          <button
            onClick={handleStartAnalysis}
            disabled={!canSubmit || !customValid || submitting}
            className="w-full py-3 rounded-lg font-medium text-sm transition disabled:opacity-40"
            style={{ backgroundColor: '#1a1a1a', color: '#ffffff' }}
          >
            開始分析
          </button>
        </div>
      )}

      {/* Processing view: live progress for the task being viewed */}
      {view === 'processing' && progress && (
        <ProgressBar
          total={progress.total_items}
          completed={progress.completed_items}
          status={progress.status}
        />
      )}

      {/* Results view */}
      {view === 'results' && (
        <div className="space-y-6">
          {/* Condition filter toggle for results */}
          {viewConfig.conditionText && (
            <div className="flex items-center gap-3 rounded-xl p-4" style={{ backgroundColor: '#ffffff', border: '1px solid #e8e8e5' }}>
              <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: '#1a1a1a' }}>
                <input
                  type="checkbox"
                  checked={viewConfig.conditionFilterEnabled}
                  onChange={e => setViewConfig({ ...viewConfig, conditionFilterEnabled: e.target.checked })}
                  className="w-4 h-4 accent-[#2d2d2d]"
                />
                僅顯示符合「{viewConfig.conditionText}」的內容
              </label>
            </div>
          )}

          {/* Quadrant labels - above chart. Deep tasks read percentages from the
              persisted aggregates (engagement-weighted); light tasks count rows. */}
          {(() => {
            const isDeep = progress?.mode === 'deep';
            const agg = isDeep ? progress?.aggregates?.[0] : undefined;
            let pct: number[];
            if (isDeep) {
              const q = agg?.quadrants;
              // Display order: [UL 超級黑粉, UR 超級鐵粉, LL 理性黑粉, LR 理性粉絲]
              pct = q ? [q.tl, q.tr, q.bl, q.br].map(v => Math.round(v)) : [0, 0, 0, 0];
            } else {
              const visible = results.filter(r => {
                if (r.status !== 'completed' || r.x_score === null || r.y_score === null) return false;
                if (viewConfig.conditionFilterEnabled && viewConfig.conditionText) return r.condition_result === true;
                return true;
              });
              const counts = computeQuadrantCounts(visible.map(r => ({ x: r.x_score!, y: r.y_score! })));
              const total = visible.length || 1;
              pct = counts.map(c => Math.round((c / total) * 100));
            }
            return (
              <>
                <div className="flex justify-between text-sm" style={{ color: '#6b6b6b' }}>
                  <span>{viewConfig.mode === 'brand' ? `超級黑粉 ${pct[0]}%` : `${pct[0]}%`}</span>
                  <span>{viewConfig.mode === 'brand' ? `超級鐵粉 ${pct[1]}%` : `${pct[1]}%`}</span>
                </div>
                <ScatterPlot
                  results={results}
                  xAxisName={viewConfig.xAxis.name}
                  yAxisName={viewConfig.yAxis.name}
                  conditionFilterEnabled={viewConfig.conditionFilterEnabled}
                  conditionText={viewConfig.conditionText}
                  dotColor={viewConfig.dotColor}
                  weighted={isDeep}
                  platformAlpha={isDeep ? progress?.platform_settings?.scatter_alpha ?? undefined : undefined}
                />
                <div className="flex justify-between text-sm" style={{ color: '#6b6b6b' }}>
                  <span>{viewConfig.mode === 'brand' ? `理性黑粉 ${pct[2]}%` : `${pct[2]}%`}</span>
                  <span>{viewConfig.mode === 'brand' ? `理性粉絲 ${pct[3]}%` : `${pct[3]}%`}</span>
                </div>
                {isDeep && (
                  <WeeklyTimeline
                    buckets={agg?.weekly_buckets ?? []}
                    title="逐週聲量（正面 / 負面）"
                  />
                )}
              </>
            );
          })()}

          {/* Export buttons */}
          <div className="flex gap-3">
            <button
              onClick={() => exportScatterPlotPNG(
                results, viewConfig.xAxis.name, viewConfig.yAxis.name,
                viewConfig.conditionFilterEnabled, viewConfig.conditionText,
                viewConfig.dotColor, viewConfig.projectName, viewConfig.mode
              )}
              className="px-4 py-2 rounded-lg text-sm font-medium transition"
              style={{ backgroundColor: '#1a1a1a', color: '#ffffff' }}
            >
              下載散佈圖
            </button>
            <button
              onClick={() => exportReportCSV(results, !!viewConfig.conditionText, viewConfig.projectName)}
              className="px-4 py-2 rounded-lg text-sm font-medium transition"
              style={{ backgroundColor: '#f5f5f3', color: '#1a1a1a' }}
            >
              下載分析報表
            </button>
            {/* Deep-mode-only: download XLSX with current detail + historical summary */}
            {progress?.mode === 'deep' && currentTaskId && (
              <>
                <a
                  href={`/api/tasks/${currentTaskId}/export-xlsx`}
                  className="px-4 py-2 rounded-lg text-sm font-medium transition"
                  style={{ backgroundColor: '#1a1a1a', color: '#ffffff' }}
                >
                  下載完整 XLSX
                </a>
                <button
                  onClick={async () => {
                    if (!currentTaskId) return;
                    // Serialize the rendered chart canvases so the zip contains
                    // the real images the user is looking at.
                    const charts: Array<{ filename: string; base64: string }> = [];
                    for (const [selector, filename] of [
                      ['canvas[data-chart="scatter"]', 'scatter.png'],
                      ['canvas[data-chart="timeline"]', 'weekly-timeline.png'],
                    ] as const) {
                      const canvas = document.querySelector<HTMLCanvasElement>(selector);
                      if (canvas) {
                        charts.push({
                          filename,
                          base64: canvas.toDataURL('image/png').split(',')[1],
                        });
                      }
                    }
                    const res = await fetch(`/api/tasks/${currentTaskId}/export-bundle`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ charts }),
                    });
                    if (res.headers.get('X-Async-Mode') === 'true') {
                      alert('大型任務打包改走背景處理，請稍後至歷史紀錄下載。');
                      return;
                    }
                    const blob = await res.blob();
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `charts-${currentTaskId}.zip`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                  className="px-4 py-2 rounded-lg text-sm font-medium transition"
                  style={{ backgroundColor: '#f5f5f3', color: '#1a1a1a' }}
                >
                  Download All Charts
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* History view */}
      {view === 'history' && (
        <div className="space-y-3">
          {history.length === 0 && (
            <p className="text-sm text-center py-12" style={{ color: '#6b6b6b' }}>
              尚無分析紀錄
            </p>
          )}
          {history.map(task => (
            <div
              key={task.task_id}
              className="rounded-xl p-5 cursor-pointer transition"
              style={{ backgroundColor: '#ffffff', border: '1px solid #e8e8e5' }}
              onClick={() => handleViewResult(task.task_id)}
            >
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm font-medium" style={{ color: '#1a1a1a' }}>
                    {(task.config as AnalysisConfig)?.projectName
                      ? `${(task.config as AnalysisConfig).projectName}：`
                      : ''}
                    {(task.config as AnalysisConfig)?.xAxis?.name || '好感度'} ×{' '}
                    {(task.config as AnalysisConfig)?.yAxis?.name || '情緒強度'}
                  </span>
                  <span className="text-xs ml-3" style={{ color: '#6b6b6b' }}>
                    {task.total_items} 則
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className="text-xs px-2 py-1 rounded-lg"
                    style={{
                      backgroundColor: task.status === 'completed' ? '#e8f0e8' : task.status === 'processing' ? '#fef9ef' : '#fef0f0',
                      color: task.status === 'completed' ? '#2d5a2d' : task.status === 'processing' ? '#8a6d3b' : '#c75c5c',
                    }}
                  >
                    {task.status === 'completed' ? '已完成' : task.status === 'processing' ? '進行中' : task.status === 'error' ? '錯誤' : '等待中'}
                  </span>
                  <span className="text-xs" style={{ color: '#c0c0c0' }}>
                    {new Date(task.created_at).toLocaleDateString('zh-TW')}
                  </span>
                  {task.mode !== 'deep' && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        const taskConfig = task.config as AnalysisConfig;
                        setConfig({
                          ...taskConfig,
                          projectName: '',
                        });
                        setFiles([]);
                        setView('config');
                      }}
                      className="text-xs px-2 py-1 rounded-lg transition"
                      style={{ color: '#1a1a1a', backgroundColor: '#f5f5f3' }}
                    >
                      複製設定
                    </button>
                  )}
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (!window.confirm('確定要移除這筆分析紀錄嗎？此操作無法復原。')) return;
                      await fetch(`/api/tasks/${task.task_id}`, { method: 'DELETE' });
                      fetchHistory();
                    }}
                    className="text-xs px-2 py-1 rounded-lg transition"
                    style={{ color: '#c75c5c' }}
                  >
                    移除
                  </button>
                </div>
              </div>
              {/* Inline progress bar for processing tasks */}
              {(task.status === 'processing' || task.status === 'pending') && (
                <div className="mt-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs" style={{ color: '#6b6b6b' }}>
                      分析中...
                    </span>
                    <span className="text-xs" style={{ color: '#6b6b6b' }}>
                      {task.completed_items} / {task.total_items}（{task.total_items > 0 ? Math.round((task.completed_items / task.total_items) * 100) : 0}%）
                    </span>
                  </div>
                  <div className="w-full h-1.5 rounded-full" style={{ backgroundColor: '#f5f5f3' }}>
                    <div
                      className="h-1.5 rounded-full transition-all duration-300"
                      style={{
                        width: `${task.total_items > 0 ? Math.round((task.completed_items / task.total_items) * 100) : 0}%`,
                        backgroundColor: '#2d2d2d',
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
