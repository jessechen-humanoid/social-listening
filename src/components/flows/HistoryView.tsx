"use client";

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api-client';
import { getBrowserUuid } from '@/lib/browser-uuid';
import type { AnalysisConfig, DeepAnalysisConfig, TaskProgress } from '@/lib/types';

// Self-contained history list (spec "Route-per-view navigation"): fetches and
// polls its own data; card clicks navigate to shareable result URLs.
export default function HistoryView() {
  const router = useRouter();
  const [browserUuid, setBrowserUuid] = useState('');
  const [history, setHistory] = useState<TaskProgress[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setBrowserUuid(getBrowserUuid()), 0);
    return () => clearTimeout(id);
  }, []);

  const fetchHistory = useCallback(async () => {
    if (!browserUuid) return;
    try {
      const data = await apiFetch<{ tasks: TaskProgress[] }>(
        `/api/tasks?browserUuid=${browserUuid}`
      );
      setHistory(data.tasks || []);
      setLoadError(false);
    } catch {
      // Visible failure state instead of a silent empty list
      // (spec "Inline error feedback replaces alert dialogs").
      setLoadError(true);
    } finally {
      setLoaded(true);
    }
  }, [browserUuid]);

  useEffect(() => {
    if (!browserUuid) return;
    const id = setTimeout(() => { fetchHistory(); }, 0);
    return () => clearTimeout(id);
  }, [browserUuid, fetchHistory]);

  // Poll while any task is processing; stops as soon as none are (existing
  // stop condition preserved through the route split).
  useEffect(() => {
    const hasProcessing = history.some(t => t.status === 'processing');
    if (!hasProcessing) return;
    const id = setInterval(() => { fetchHistory(); }, 3000);
    return () => clearInterval(id);
  }, [history, fetchHistory]);

  if (loadError) {
    return (
      <div className="rounded-xl p-6 text-center" style={{ backgroundColor: 'var(--color-card)', border: '1px solid var(--color-line)' }}>
        <p className="text-sm mb-3" style={{ color: 'var(--color-danger)' }}>載入歷史紀錄失敗</p>
        <button
          onClick={() => fetchHistory()}
          className="text-sm px-4 py-2 rounded-lg transition"
          style={{ backgroundColor: 'var(--color-ink)', color: 'var(--color-card)' }}
        >
          重試
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {loaded && history.length === 0 && (
        <p className="text-sm text-center py-12" style={{ color: 'var(--color-muted)' }}>
          尚無分析紀錄
        </p>
      )}
      {(() => {
        // Group batch tasks into one card per batch_id; legacy tasks stay solo.
        const byBatch = new Map<string, TaskProgress[]>();
        for (const t of history) {
          if (t.batch_id) {
            if (!byBatch.has(t.batch_id)) byBatch.set(t.batch_id, []);
            byBatch.get(t.batch_id)!.push(t);
          }
        }
        const seenBatch = new Set<string>();
        const entries: Array<
          | { type: 'single'; task: TaskProgress }
          | { type: 'batch'; batchId: string; title: string; tasks: TaskProgress[] }
        > = [];
        for (const t of history) {
          if (t.batch_id) {
            if (seenBatch.has(t.batch_id)) continue;
            seenBatch.add(t.batch_id);
            const tasks = byBatch.get(t.batch_id)!;
            const dc = tasks[0].config as unknown as DeepAnalysisConfig;
            entries.push({
              type: 'batch',
              batchId: t.batch_id,
              title: dc?.projectName || dc?.brandName || '深度批次',
              tasks,
            });
          } else {
            entries.push({ type: 'single', task: t });
          }
        }
        return entries.map(entry => {
          if (entry.type === 'batch') {
            const total = entry.tasks.reduce((sum, t) => sum + t.total_items, 0);
            return (
              <div
                key={entry.batchId}
                className="rounded-xl p-5 cursor-pointer transition"
                style={{ backgroundColor: 'var(--color-card)', border: '1px solid var(--color-line)' }}
                onClick={() => router.push(`/batch/${entry.batchId}`)}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm font-medium" style={{ color: 'var(--color-ink)' }}>
                      {entry.title}
                    </span>
                    <span className="text-xs ml-3" style={{ color: 'var(--color-muted)' }}>
                      {total} 則・{entry.tasks.length} 平台
                    </span>
                  </div>
                  <span className="text-xs" style={{ color: 'var(--color-faint)' }}>
                    {new Date(entry.tasks[0].created_at).toLocaleDateString('zh-TW')}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2 mt-3">
                  {entry.tasks.map(t => {
                    const pctDone = t.total_items > 0
                      ? Math.round((t.completed_items / t.total_items) * 100)
                      : 0;
                    return (
                      <span
                        key={t.task_id}
                        className="text-xs px-2 py-1 rounded-lg"
                        style={{
                          backgroundColor:
                            t.status === 'completed' ? '#e8f0e8'
                            : t.status === 'error' ? '#fef0f0' : '#fef9ef',
                          color:
                            t.status === 'completed' ? '#2d5a2d'
                            : t.status === 'error' ? 'var(--color-danger)' : '#8a6d3b',
                        }}
                      >
                        {(t.platform ?? '').toUpperCase()}{' '}
                        {t.status === 'completed' ? '✓'
                          : t.status === 'error' ? '✗'
                          : t.status === 'processing' ? `${pctDone}%` : '等待中'}
                      </span>
                    );
                  })}
                </div>
              </div>
            );
          }
          const task = entry.task;
          return (
            <div
              key={task.task_id}
              className="rounded-xl p-5 cursor-pointer transition"
              style={{ backgroundColor: 'var(--color-card)', border: '1px solid var(--color-line)' }}
              onClick={() => router.push(`/task/${task.task_id}`)}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {task.mode === 'deep' ? (() => {
                    const dc = task.config as unknown as DeepAnalysisConfig;
                    const pctDone = task.total_items > 0
                      ? Math.round((task.completed_items / task.total_items) * 100)
                      : 0;
                    return (
                      <>
                        <span className="text-sm font-medium" style={{ color: 'var(--color-ink)' }}>
                          {dc?.projectName || dc?.brandName || '深度分析'}
                        </span>
                        {dc?.projectName && dc?.brandName && (
                          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
                            {dc.brandName}
                          </span>
                        )}
                        <span
                          className="text-xs px-2 py-1 rounded-lg"
                          style={{
                            backgroundColor:
                              task.status === 'completed' ? '#e8f0e8'
                              : task.status === 'error' ? '#fef0f0' : '#fef9ef',
                            color:
                              task.status === 'completed' ? '#2d5a2d'
                              : task.status === 'error' ? 'var(--color-danger)' : '#8a6d3b',
                          }}
                        >
                          {(dc?.platform ?? '').toUpperCase()}{' '}
                          {task.status === 'completed' ? '✓'
                            : task.status === 'error' ? '✗'
                            : task.status === 'processing' ? `${pctDone}%` : '等待中'}
                        </span>
                      </>
                    );
                  })() : (
                    <span className="text-sm font-medium" style={{ color: 'var(--color-ink)' }}>
                      {`${(task.config as AnalysisConfig)?.projectName
                          ? `${(task.config as AnalysisConfig).projectName}：`
                          : ''}${(task.config as AnalysisConfig)?.xAxis?.name || '好感度'} × ${(task.config as AnalysisConfig)?.yAxis?.name || '情緒強度'}`}
                    </span>
                  )}
                  <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
                    {task.total_items} 則
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {task.mode !== 'deep' && (
                  <span
                    className="text-xs px-2 py-1 rounded-lg"
                    style={{
                      backgroundColor: task.status === 'completed' ? '#e8f0e8' : task.status === 'processing' ? '#fef9ef' : '#fef0f0',
                      color: task.status === 'completed' ? '#2d5a2d' : task.status === 'processing' ? '#8a6d3b' : 'var(--color-danger)',
                    }}
                  >
                    {task.status === 'completed' ? '已完成' : task.status === 'processing' ? '進行中' : task.status === 'error' ? '錯誤' : '等待中'}
                  </span>
                  )}
                  <span className="text-xs" style={{ color: 'var(--color-faint)' }}>
                    {new Date(task.created_at).toLocaleDateString('zh-TW')}
                  </span>
                  {task.mode !== 'deep' && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        // Hand the copied config to the light form on `/`.
                        // Interim bridge until the upload-draft context lands;
                        // File objects were never copied by this feature.
                        sessionStorage.setItem(
                          'copied-light-config',
                          JSON.stringify({ ...(task.config as AnalysisConfig), projectName: '' })
                        );
                        router.push('/');
                      }}
                      className="text-xs px-2 py-1 rounded-lg transition"
                      style={{ color: 'var(--color-ink)', backgroundColor: '#f5f5f3' }}
                    >
                      複製設定
                    </button>
                  )}
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (!window.confirm('確定要移除這筆分析紀錄嗎？此操作無法復原。')) return;
                      try {
                        await apiFetch(`/api/tasks/${task.task_id}`, { method: 'DELETE' });
                      } catch { /* refetch below reflects the true state either way */ }
                      fetchHistory();
                    }}
                    className="text-xs px-2 py-1 rounded-lg transition"
                    style={{ color: 'var(--color-danger)' }}
                  >
                    移除
                  </button>
                </div>
              </div>
              {(task.status === 'processing' || task.status === 'pending') && (
                <div className="mt-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
                      分析中...
                    </span>
                    <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
                      {task.completed_items} / {task.total_items}（{task.total_items > 0 ? Math.round((task.completed_items / task.total_items) * 100) : 0}%）
                    </span>
                  </div>
                  <div className="w-full h-1.5 rounded-full" style={{ backgroundColor: '#f5f5f3' }}>
                    <div
                      className="h-1.5 rounded-full transition-all duration-300"
                      style={{
                        width: `${task.total_items > 0 ? Math.round((task.completed_items / task.total_items) * 100) : 0}%`,
                        backgroundColor: 'var(--color-accent)',
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          );
        });
      })()}
    </div>
  );
}
