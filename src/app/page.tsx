"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import FileUpload from '@/components/FileUpload';
import AnalysisConfigPanel from '@/components/AnalysisConfig';
import ScatterPlot, { exportScatterPlotPNG, computeQuadrantCounts } from '@/components/ScatterPlot';
import ProgressBar from '@/components/ProgressBar';
import { exportReportCSV } from '@/lib/export-report';
import { getBrowserUuid } from '@/lib/browser-uuid';
import type { UploadedFile, AnalysisConfig, TaskResult, TaskProgress } from '@/lib/types';

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

type ViewState = 'config' | 'processing' | 'results' | 'history';

export default function Home() {
  const [view, setView] = useState<ViewState>('config');
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [config, setConfig] = useState<AnalysisConfig>(DEFAULT_CONFIG);
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);
  const [progress, setProgress] = useState<TaskProgress | null>(null);
  const [results, setResults] = useState<TaskResult[]>([]);
  const [history, setHistory] = useState<TaskProgress[]>([]);
  const [browserUuid, setBrowserUuid] = useState('');
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Initialize UUID
  useEffect(() => {
    setBrowserUuid(getBrowserUuid());
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
    if (browserUuid) fetchHistory();
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
    if (!canSubmit || !customValid) return;

    try {
      const payload = {
        browserUuid,
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
    }
  };

  const handleViewResult = async (taskId: string) => {
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

      setProgress(progressData);
      setResults(resultsData.results || []);

      if (progressData.config) {
        setConfig(progressData.config);
      }

      if (progressData.status === 'processing') {
        setView('processing');
      } else {
        setView('results');
      }
    } catch { /* ignore */ }
  };

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
            新增分析
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

      {/* Config view */}
      {view === 'config' && (
        <div className="space-y-6">
          <AnalysisConfigPanel config={config} onChange={setConfig} totalRows={files.reduce((sum, f) => sum + f.rowCount, 0)} />
          <FileUpload files={files} onChange={setFiles} />

          <button
            onClick={handleStartAnalysis}
            disabled={!canSubmit || !customValid}
            className="w-full py-3 rounded-lg font-medium text-sm transition disabled:opacity-40"
            style={{ backgroundColor: '#1a1a1a', color: '#ffffff' }}
          >
            開始分析
          </button>
        </div>
      )}

      {/* Results view */}
      {view === 'results' && (
        <div className="space-y-6">
          {/* Condition filter toggle for results */}
          {config.conditionText && (
            <div className="flex items-center gap-3 rounded-xl p-4" style={{ backgroundColor: '#ffffff', border: '1px solid #e8e8e5' }}>
              <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: '#1a1a1a' }}>
                <input
                  type="checkbox"
                  checked={config.conditionFilterEnabled}
                  onChange={e => setConfig({ ...config, conditionFilterEnabled: e.target.checked })}
                  className="w-4 h-4 accent-[#2d2d2d]"
                />
                僅顯示符合「{config.conditionText}」的內容
              </label>
            </div>
          )}

          {/* Quadrant labels - above chart */}
          {(() => {
            const visible = results.filter(r => {
              if (r.status !== 'completed' || r.x_score === null || r.y_score === null) return false;
              if (config.conditionFilterEnabled && config.conditionText) return r.condition_result === true;
              return true;
            });
            const counts = computeQuadrantCounts(visible.map(r => ({ x: r.x_score!, y: r.y_score! })));
            const total = visible.length || 1;
            const pct = counts.map(c => Math.round((c / total) * 100));
            return (
              <>
                <div className="flex justify-between text-sm" style={{ color: '#6b6b6b' }}>
                  <span>超級黑粉 {pct[0]}%</span>
                  <span>超級鐵粉 {pct[1]}%</span>
                </div>
                <ScatterPlot
                  results={results}
                  xAxisName={config.xAxis.name}
                  yAxisName={config.yAxis.name}
                  conditionFilterEnabled={config.conditionFilterEnabled}
                  conditionText={config.conditionText}
                  dotColor={config.dotColor}
                />
                <div className="flex justify-between text-sm" style={{ color: '#6b6b6b' }}>
                  <span>理性黑粉 {pct[2]}%</span>
                  <span>理性粉絲 {pct[3]}%</span>
                </div>
              </>
            );
          })()}

          {/* Export buttons */}
          <div className="flex gap-3">
            <button
              onClick={() => exportScatterPlotPNG(
                results, config.xAxis.name, config.yAxis.name,
                config.conditionFilterEnabled, config.conditionText,
                config.dotColor, config.projectName
              )}
              className="px-4 py-2 rounded-lg text-sm font-medium transition"
              style={{ backgroundColor: '#1a1a1a', color: '#ffffff' }}
            >
              下載散佈圖
            </button>
            <button
              onClick={() => exportReportCSV(results, !!config.conditionText, config.projectName)}
              className="px-4 py-2 rounded-lg text-sm font-medium transition"
              style={{ backgroundColor: '#f5f5f3', color: '#1a1a1a' }}
            >
              下載分析報表
            </button>
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
