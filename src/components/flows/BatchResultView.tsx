"use client";

import { useCallback, useEffect, useState } from 'react';
import JSZip from 'jszip';
import ScatterPlot from '@/components/ScatterPlot';
import WeeklyTimeline from '@/components/WeeklyTimeline';
import { apiFetch } from '@/lib/api-client';
import { sanitizeFilename } from '@/lib/sanitize-export';
import type { DeepAnalysisConfig, TaskProgress, TaskResult } from '@/lib/types';

const PLATFORM_ORDER = ['fb', 'ig', 'threads', 'dcard'] as const;
const PLATFORM_DISPLAY: Record<string, string> = {
  fb: 'Facebook', ig: 'Instagram', threads: 'Threads', dcard: '論壇（Dcard）',
};

interface BatchItem {
  taskId: string;
  platform: string;
  progress: TaskProgress;
  results: TaskResult[];
}

// Shareable batch results (spec "Shareable task and batch result URLs"):
// resolves everything from the batchId in the URL via the team-shared
// batch listing, so any member can open a pasted link.
export default function BatchResultView({ batchId }: { batchId: string }) {
  const [title, setTitle] = useState('');
  const [items, setItems] = useState<BatchItem[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState('');

  const load = useCallback(async () => {
    try {
      const listing = await apiFetch<{ tasks: TaskProgress[] }>(`/api/tasks?batchId=${batchId}`);
      const tasks = listing.tasks || [];
      if (tasks.length === 0) {
        setLoadError(true);
        return;
      }
      const dc = tasks[0].config as unknown as DeepAnalysisConfig;
      setTitle(dc?.projectName || dc?.brandName || '深度批次');

      const loaded = await Promise.all(
        tasks.map(async (t) => {
          const [progress, resultsData] = await Promise.all([
            apiFetch<TaskProgress>(`/api/tasks/${t.task_id}/progress`),
            apiFetch<{ results: TaskResult[] }>(`/api/tasks/${t.task_id}/results?view=chart`),
          ]);
          return {
            taskId: t.task_id,
            platform: String(t.platform ?? ''),
            progress,
            results: resultsData.results || [],
          } as BatchItem;
        })
      );
      loaded.sort(
        (a, b) =>
          PLATFORM_ORDER.indexOf(a.platform as (typeof PLATFORM_ORDER)[number]) -
          PLATFORM_ORDER.indexOf(b.platform as (typeof PLATFORM_ORDER)[number])
      );
      setItems(loaded);
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, [batchId]);

  useEffect(() => {
    setItems(null);
    load();
  }, [load]);

  // One zip for the whole batch: per-platform scatter PNG + timeline PNG
  // (serialized from the rendered canvases) + the task's full xlsx report.
  const handleDownloadBatch = async () => {
    if (!items || downloading) return;
    setDownloading(true);
    setDownloadError('');
    try {
      const zip = new JSZip();
      for (const item of items) {
        const dir = item.platform.toUpperCase();
        const section = document.querySelector(`div[data-batch-platform="${item.platform}"]`);
        for (const [tag, name] of [
          ['scatter', 'scatter.png'],
          ['timeline', 'weekly-timeline.png'],
        ] as const) {
          const canvas = section?.querySelector<HTMLCanvasElement>(`canvas[data-chart="${tag}"]`);
          if (canvas) {
            zip.file(`${dir}/${name}`, canvas.toDataURL('image/png').split(',')[1], { base64: true });
          }
        }
        const xlsxRes = await fetch(`/api/tasks/${item.taskId}/export-xlsx`);
        if (xlsxRes.ok) {
          zip.file(`${dir}/report.xlsx`, await xlsxRes.blob());
        }
      }
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${sanitizeFilename(title || 'batch')}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setDownloadError('打包失敗，請重試');
    } finally {
      setDownloading(false);
    }
  };

  if (loadError) {
    return (
      <div className="rounded-xl p-6 text-center" style={{ backgroundColor: 'var(--color-card)', border: '1px solid var(--color-line)' }}>
        <p className="text-sm mb-3" style={{ color: 'var(--color-danger)' }}>載入批次結果失敗</p>
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

  if (!items) {
    return <p className="text-sm text-center py-12" style={{ color: 'var(--color-muted)' }}>載入中…</p>;
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium" style={{ color: 'var(--color-ink)' }}>
          {title}
        </h2>
        <span className="flex items-center gap-2">
          {downloadError && (
            <span className="text-xs" style={{ color: 'var(--color-danger)' }}>{downloadError}</span>
          )}
          <button
            onClick={handleDownloadBatch}
            disabled={downloading}
            className="px-4 py-2 rounded-lg text-sm font-medium transition disabled:opacity-40"
            style={{ backgroundColor: 'var(--color-ink)', color: 'var(--color-card)' }}
          >
            {downloading ? '打包中…' : '下載全部（圖表 + 報表）'}
          </button>
        </span>
      </div>

      {items.map(item => {
        const agg = item.progress.aggregates?.[0];
        const q = agg?.quadrants;
        const pct = q ? [q.tl, q.tr, q.bl, q.br].map(v => Math.round(v)) : [0, 0, 0, 0];
        const alpha = item.progress.platform_settings?.scatter_alpha ?? undefined;
        return (
          <div
            key={item.taskId}
            data-batch-platform={item.platform}
            className="space-y-3 rounded-xl p-5"
            style={{ backgroundColor: 'var(--color-card)', border: '1px solid var(--color-line)' }}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium" style={{ color: 'var(--color-ink)' }}>
                {PLATFORM_DISPLAY[item.platform] ?? item.platform}
              </span>
              <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
                樣本 {agg?.sample_count ?? 0} 則
                {(() => {
                  const n = item.results.filter(r => r.status === 'unscorable').length;
                  return n > 0 ? `・無法評分 ${n} 則（已列入報表供人工判讀）` : '';
                })()}
                {item.progress.status !== 'completed' && `・${item.progress.status === 'error' ? '分析失敗' : '分析中'}`}
              </span>
            </div>
            <div className="flex justify-between text-sm" style={{ color: 'var(--color-muted)' }}>
              <span>超級黑粉 {pct[0]}%</span>
              <span>超級鐵粉 {pct[1]}%</span>
            </div>
            <ScatterPlot
              results={item.results}
              xAxisName="品牌好感度"
              yAxisName="情緒強度"
              conditionFilterEnabled={false}
              conditionText=""
              dotColor="#0000FF"
              weighted
              platformAlpha={alpha}
            />
            <div className="flex justify-between text-sm" style={{ color: 'var(--color-muted)' }}>
              <span>理性黑粉 {pct[2]}%</span>
              <span>理性粉絲 {pct[3]}%</span>
            </div>
            <WeeklyTimeline
              buckets={agg?.weekly_buckets ?? []}
              title={`逐週聲量（${PLATFORM_DISPLAY[item.platform] ?? item.platform}）`}
            />
          </div>
        );
      })}
    </div>
  );
}
