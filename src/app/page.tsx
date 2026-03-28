"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import FileUpload from '@/components/FileUpload';
import AnalysisConfigPanel from '@/components/AnalysisConfig';
import ScatterPlot, { exportScatterPlotPNG } from '@/components/ScatterPlot';
import ProgressBar from '@/components/ProgressBar';
import { exportReportCSV } from '@/lib/export-report';
import { getBrowserUuid } from '@/lib/browser-uuid';
import type { UploadedFile, AnalysisConfig, TaskResult, TaskProgress } from '@/lib/types';

const DEFAULT_CONFIG: AnalysisConfig = {
  mode: 'brand',
  conditionText: '',
  conditionFilterEnabled: false,
  xAxis: { name: '好感度', zeroDescription: '對品牌完全負面', tenDescription: '對品牌高度正面' },
  yAxis: { name: '情緒強度', zeroDescription: '平淡無情緒', tenDescription: '情緒非常激烈' },
  model: 'gpt-4o',
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

      // Check for in-progress task
      const activeTask = data.tasks?.find((t: TaskProgress) => t.status === 'processing');
      if (activeTask && view === 'config') {
        setCurrentTaskId(activeTask.task_id);
        setView('processing');
      }
    } catch { /* ignore */ }
  }, [browserUuid, view]);

  useEffect(() => {
    if (browserUuid) fetchHistory();
  }, [browserUuid, fetchHistory]);

  // Poll progress
  useEffect(() => {
    if (view !== 'processing' || !currentTaskId) return;

    const poll = async () => {
      try {
        const res = await fetch(`/api/tasks/${currentTaskId}/progress`);
        const data = await res.json();
        setProgress(data);

        if (data.status === 'completed' || data.status === 'error') {
          if (pollingRef.current) clearInterval(pollingRef.current);
          // Fetch results
          const resResults = await fetch(`/api/tasks/${currentTaskId}/results`);
          const resultsData = await resResults.json();
          setResults(resultsData.results || []);
          setConfig(data.config || config);
          setView('results');
        }
      } catch { /* ignore */ }
    };

    poll();
    pollingRef.current = setInterval(poll, 2000);
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [view, currentTaskId, config]);

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
        setCurrentTaskId(data.task_id);
        setView('processing');
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
          <AnalysisConfigPanel config={config} onChange={setConfig} />
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

      {/* Processing view */}
      {view === 'processing' && progress && (
        <div className="space-y-6">
          <ProgressBar
            total={progress.total_items}
            completed={progress.completed_items}
            status={progress.status}
          />
          <p className="text-sm text-center" style={{ color: '#6b6b6b' }}>
            分析持續在伺服器端進行，關閉瀏覽器不會影響分析。
          </p>
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

          <ScatterPlot
            results={results}
            xAxisName={config.xAxis.name}
            yAxisName={config.yAxis.name}
            conditionFilterEnabled={config.conditionFilterEnabled}
            conditionText={config.conditionText}
          />

          {/* Export buttons */}
          <div className="flex gap-3">
            <button
              onClick={() => exportScatterPlotPNG(
                results, config.xAxis.name, config.yAxis.name,
                config.conditionFilterEnabled, config.conditionText
              )}
              className="px-4 py-2 rounded-lg text-sm font-medium transition"
              style={{ backgroundColor: '#1a1a1a', color: '#ffffff' }}
            >
              下載散佈圖
            </button>
            <button
              onClick={() => exportReportCSV(results, !!config.conditionText)}
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
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
