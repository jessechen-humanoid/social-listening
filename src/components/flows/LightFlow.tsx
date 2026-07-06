"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import FileUpload from '@/components/FileUpload';
import AnalysisConfigPanel from '@/components/AnalysisConfig';
import { getBrowserUuid } from '@/lib/browser-uuid';
import { apiFetch } from '@/lib/api-client';
import { slimRow } from '@/lib/column-mapping';
import { useUploadDraft } from '@/lib/upload-draft-context';
import type { AnalysisConfig } from '@/lib/types';

// Light analysis form (route `/`). Submit navigates to /history where the
// new task's card shows inline progress.
export default function LightFlow() {
  const router = useRouter();
  const [browserUuid, setBrowserUuid] = useState('');
  // Draft lives in the layout-level provider — navigation keeps it intact
  // (spec "Upload draft persistence across navigation").
  const {
    lightFiles: files, setLightFiles: setFiles,
    lightConfig: config, setLightConfig: setConfig,
    resetLight,
  } = useUploadDraft();
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  useEffect(() => {
    const id = setTimeout(() => setBrowserUuid(getBrowserUuid()), 0);
    return () => clearTimeout(id);
  }, []);

  // 複製設定 bridge from the history page (sessionStorage, one-shot).
  useEffect(() => {
    const copied = sessionStorage.getItem('copied-light-config');
    if (!copied) return;
    sessionStorage.removeItem('copied-light-config');
    try {
      setConfig(JSON.parse(copied) as AnalysisConfig);
    } catch { /* corrupt payload — keep defaults */ }
  }, [setConfig]);

  const canSubmit = files.length > 0 && files.every(f => f.contentColumn !== '');
  const customValid = config.mode === 'custom'
    ? config.xAxis.name && config.yAxis.name
    : true;

  const handleStartAnalysis = async () => {
    if (!canSubmit || !customValid || submitting) return;
    setSubmitting(true);
    setSubmitError('');

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
          // Only the selected columns travel (spec "Upload payload carries
          // only mapped columns").
          data: f.data.map(row => slimRow(row, [f.contentColumn, f.engagementColumn || undefined])),
        })),
      };

      const data = await apiFetch<{ task_id?: string }>('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (data.task_id) {
        resetLight();
        router.push('/history');
      } else {
        setSubmitError('建立任務失敗');
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : '發生錯誤');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <AnalysisConfigPanel config={config} onChange={setConfig} totalRows={files.reduce((sum, f) => sum + f.rowCount, 0)} />
      <FileUpload files={files} onChange={setFiles} />

      {submitError && (
        <p className="text-sm rounded-lg p-3" style={{ color: 'var(--color-danger)', backgroundColor: '#fef0f0' }}>
          {submitError}
        </p>
      )}
      <button
        onClick={handleStartAnalysis}
        disabled={!canSubmit || !customValid || submitting}
        className="w-full py-3 rounded-lg font-medium text-sm transition disabled:opacity-40"
        style={{ backgroundColor: 'var(--color-ink)', color: 'var(--color-card)' }}
      >
        開始分析
      </button>
    </div>
  );
}
