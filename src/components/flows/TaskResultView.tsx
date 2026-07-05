"use client";

import { useCallback, useEffect, useState } from 'react';
import ScatterPlot, { exportScatterPlotPNG, computeQuadrantCounts } from '@/components/ScatterPlot';
import WeeklyTimeline from '@/components/WeeklyTimeline';
import ProgressBar from '@/components/ProgressBar';
import { exportReportCSV } from '@/lib/export-report';
import { sanitizeFilename } from '@/lib/sanitize-export';
import { apiFetch } from '@/lib/api-client';
import type { AnalysisConfig, DeepAnalysisConfig, TaskProgress, TaskResult } from '@/lib/types';

const DEFAULT_VIEW_CONFIG: AnalysisConfig = {
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

// Shareable single-task results (spec "Shareable task and batch result
// URLs"): everything is derived from the taskId in the URL — opening the
// link in a fresh session renders the same view.
export default function TaskResultView({ taskId }: { taskId: string }) {
  const [progress, setProgress] = useState<TaskProgress | null>(null);
  const [results, setResults] = useState<TaskResult[]>([]);
  const [viewConfig, setViewConfig] = useState<AnalysisConfig>(DEFAULT_VIEW_CONFIG);
  const [loadError, setLoadError] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const [progressData, resultsData] = await Promise.all([
        apiFetch<TaskProgress>(`/api/tasks/${taskId}/progress`),
        apiFetch<{ results: TaskResult[] }>(`/api/tasks/${taskId}/results`),
      ]);
      setProgress(progressData);
      setResults(resultsData.results || []);

      // Deep task configs have no xAxis/yAxis — render them with fixed axis
      // names instead of pushing them into light-config-shaped state.
      if (progressData.mode === 'deep') {
        setViewConfig({
          ...DEFAULT_VIEW_CONFIG,
          projectName:
            (progressData.config as unknown as DeepAnalysisConfig)?.projectName ?? '',
          xAxis: { ...DEFAULT_VIEW_CONFIG.xAxis, name: '品牌好感度' },
          yAxis: { ...DEFAULT_VIEW_CONFIG.yAxis, name: '情緒強度' },
        });
      } else {
        setViewConfig((progressData.config as AnalysisConfig) ?? DEFAULT_VIEW_CONFIG);
      }
      setLoadError(false);
    } catch {
      setLoadError(true);
    } finally {
      setLoaded(true);
    }
  }, [taskId]);

  useEffect(() => {
    setLoaded(false);
    setProgress(null);
    load();
  }, [load]);

  // Poll while the task is processing; the view flips to results on completion.
  const processing = progress?.status === 'processing' || progress?.status === 'pending';
  useEffect(() => {
    if (!processing) return;
    const id = setInterval(() => { load(); }, 3000);
    return () => clearInterval(id);
  }, [processing, load]);

  if (loadError) {
    return (
      <div className="rounded-xl p-6 text-center" style={{ backgroundColor: 'var(--color-card)', border: '1px solid var(--color-line)' }}>
        <p className="text-sm mb-3" style={{ color: 'var(--color-danger)' }}>載入任務結果失敗</p>
        <button
          onClick={() => load()}
          className="text-sm px-4 py-2 rounded-lg transition"
          style={{ backgroundColor: 'var(--color-ink)', color: 'var(--color-card)' }}
        >
          重試
        </button>
      </div>
    );
  }

  if (!loaded || !progress) {
    return <p className="text-sm text-center py-12" style={{ color: 'var(--color-muted)' }}>載入中…</p>;
  }

  if (processing) {
    return (
      <ProgressBar
        total={progress.total_items}
        completed={progress.completed_items}
        status={progress.status}
      />
    );
  }

  const isDeep = progress.mode === 'deep';
  const agg = isDeep ? progress.aggregates?.[0] : undefined;
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
  const unscorableCount = results.filter(r => r.status === 'unscorable').length;

  return (
    <div className="space-y-6">
      {viewConfig.conditionText && (
        <div className="flex items-center gap-3 rounded-xl p-4" style={{ backgroundColor: 'var(--color-card)', border: '1px solid var(--color-line)' }}>
          <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--color-ink)' }}>
            <input
              type="checkbox"
              checked={viewConfig.conditionFilterEnabled}
              onChange={e => setViewConfig({ ...viewConfig, conditionFilterEnabled: e.target.checked })}
              className="w-4 h-4 accent-accent"
            />
            僅顯示符合「{viewConfig.conditionText}」的內容
          </label>
        </div>
      )}

      <div className="flex justify-between text-sm" style={{ color: 'var(--color-muted)' }}>
        <span>{viewConfig.mode === 'brand' ? `超級黑粉 ${pct[0]}%` : `${pct[0]}%`}</span>
        <span>{viewConfig.mode === 'brand' ? `超級鐵粉 ${pct[1]}%` : `${pct[1]}%`}</span>
      </div>
      <ScatterPlot
        results={results}
        xAxisName={viewConfig.xAxis.name}
        yAxisName={viewConfig.yAxis.name}
        conditionFilterEnabled={viewConfig.conditionFilterEnabled}
        conditionText={viewConfig.conditionText}
        dotColor={isDeep ? '#0000FF' : viewConfig.dotColor}
        weighted={isDeep}
        platformAlpha={isDeep ? progress.platform_settings?.scatter_alpha ?? undefined : undefined}
      />
      <div className="flex justify-between text-sm" style={{ color: 'var(--color-muted)' }}>
        <span>{viewConfig.mode === 'brand' ? `理性黑粉 ${pct[2]}%` : `${pct[2]}%`}</span>
        <span>{viewConfig.mode === 'brand' ? `理性粉絲 ${pct[3]}%` : `${pct[3]}%`}</span>
      </div>
      {isDeep && (
        <>
          {unscorableCount > 0 && (
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
              無法評分 {unscorableCount} 則（模型拒評，已完整列入 XLSX 報表供人工判讀）
            </p>
          )}
          <WeeklyTimeline
            buckets={agg?.weekly_buckets ?? []}
            title="逐週聲量（正面 / 負面）"
          />
        </>
      )}

      <div className="flex gap-3">
        <button
          onClick={() => exportScatterPlotPNG(
            results, viewConfig.xAxis.name, viewConfig.yAxis.name,
            viewConfig.conditionFilterEnabled, viewConfig.conditionText,
            isDeep ? '#0000FF' : viewConfig.dotColor, viewConfig.projectName, viewConfig.mode,
            isDeep, isDeep ? progress.platform_settings?.scatter_alpha ?? undefined : undefined
          )}
          className="px-4 py-2 rounded-lg text-sm font-medium transition"
          style={{ backgroundColor: 'var(--color-ink)', color: 'var(--color-card)' }}
        >
          下載散佈圖
        </button>
        <button
          onClick={() => exportReportCSV(results, !!viewConfig.conditionText, viewConfig.projectName)}
          className="px-4 py-2 rounded-lg text-sm font-medium transition"
          style={{ backgroundColor: '#f5f5f3', color: 'var(--color-ink)' }}
        >
          下載分析報表
        </button>
        {isDeep && (
          <>
            <a
              href={`/api/tasks/${taskId}/export-xlsx`}
              className="px-4 py-2 rounded-lg text-sm font-medium transition"
              style={{ backgroundColor: 'var(--color-ink)', color: 'var(--color-card)' }}
            >
              下載完整 XLSX
            </a>
            <DownloadChartsButton taskId={taskId} />
          </>
        )}
      </div>
    </div>
  );
}

function DownloadChartsButton({ taskId }: { taskId: string }) {
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  return (
    <span className="flex items-center gap-2">
      <button
        onClick={async () => {
          setError('');
          setNote('');
          try {
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
            const res = await fetch(`/api/tasks/${taskId}/export-bundle`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ charts }),
            });
            if (!res.ok) {
              setError('打包失敗，請重試');
              return;
            }
            if (res.headers.get('X-Async-Mode') === 'true') {
              setNote('大型任務打包改走背景處理，請稍後至歷史紀錄下載。');
              return;
            }
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `charts-${sanitizeFilename(taskId)}.zip`;
            a.click();
            URL.revokeObjectURL(url);
          } catch {
            setError('打包失敗，請重試');
          }
        }}
        className="px-4 py-2 rounded-lg text-sm font-medium transition"
        style={{ backgroundColor: '#f5f5f3', color: 'var(--color-ink)' }}
      >
        Download All Charts
      </button>
      {error && <span className="text-xs" style={{ color: 'var(--color-danger)' }}>{error}</span>}
      {note && <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{note}</span>}
    </span>
  );
}
