"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import FileUpload from '@/components/FileUpload';
import DeepConfig from '@/components/DeepConfig';
import ColumnMappingStep, { type ConfirmedMappings } from '@/components/ColumnMappingStep';
import { getBrowserUuid } from '@/lib/browser-uuid';
import { apiFetch } from '@/lib/api-client';
import { REQUIRED_ROLES_BY_PLATFORM } from '@/lib/validate-task-input';
import { useUploadDraft } from '@/lib/upload-draft-context';
import type { Platform } from '@/lib/platforms';

// Deep batch form (route `/deep`): upload + column-mapping two-step flow.
export default function DeepFlow() {
  const router = useRouter();
  const [browserUuid, setBrowserUuid] = useState('');
  // Draft (files, form fields, mapping step) survives navigation via the
  // layout-level provider (spec "Upload draft persistence across navigation").
  const {
    deepFiles: files, setDeepFiles: setFiles,
    deepConfig, setDeepConfig,
    deepStep: step, setDeepStep: setStep,
    resetDeep,
  } = useUploadDraft();
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  useEffect(() => {
    const id = setTimeout(() => setBrowserUuid(getBrowserUuid()), 0);
    return () => clearTimeout(id);
  }, []);

  // Deep batch: platforms that have files must each satisfy their role set
  // (spec "Platform role completeness validation" — client side mirror).
  const deepFiles = files.filter(f => f.platform && f.role);
  const platformsWithFiles = Array.from(new Set(deepFiles.map(f => f.platform as Platform)));
  const missingRolesByPlatform = platformsWithFiles.flatMap(platform => {
    const present = new Set(deepFiles.filter(f => f.platform === platform).map(f => f.role));
    return REQUIRED_ROLES_BY_PLATFORM[platform]
      .filter(role => !present.has(role))
      .map(role => ({ platform, role }));
  });
  const canProceedToMapping =
    !!deepConfig.brandId &&
    !!deepConfig.timeRangeStart &&
    !!deepConfig.timeRangeEnd &&
    platformsWithFiles.length > 0 &&
    missingRolesByPlatform.length === 0;

  const handleStartDeepAnalysis = async (mappings: ConfirmedMappings) => {
    if (submitting) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      // Expand each slot's shared mapping onto its files, grouped per platform
      // (spec "Batch upload creates one task per platform").
      const platforms = platformsWithFiles.map(platform => ({
        platform,
        files: deepFiles
          .filter(f => f.platform === platform)
          .map(f => {
            const slot = mappings.perSlot.find(
              m => m.platform === platform && m.role === f.role
            );
            return {
              filename: f.filename,
              role: f.role,
              columnMapping: slot?.mapping ?? {},
              data: f.data,
              forumFilter: platform === 'dcard' ? mappings.forumFilter : null,
            };
          }),
      }));

      const data = await apiFetch<{ tasks?: unknown[] }>('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          browserUuid,
          mode: 'deep-batch',
          config: deepConfig,
          platforms,
        }),
      });
      if (Array.isArray(data.tasks) && data.tasks.length > 0) {
        resetDeep();
        router.push('/history');
      } else {
        setSubmitError('建立深度任務失敗');
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : '發生錯誤');
    } finally {
      setSubmitting(false);
    }
  };

  if (step === 'mapping') {
    return (
      <>
        {submitError && (
          <p className="text-sm rounded-lg p-3 mb-4" style={{ color: 'var(--color-danger)', backgroundColor: '#fef0f0' }}>
            {submitError}
          </p>
        )}
        <ColumnMappingStep
          files={files}
          onBack={() => setStep('config')}
          onConfirm={handleStartDeepAnalysis}
        />
      </>
    );
  }

  return (
    <div className="space-y-6">
      <DeepConfig config={deepConfig} onChange={setDeepConfig} />
      <FileUpload files={files} onChange={setFiles} mode="deep" />
      {missingRolesByPlatform.length > 0 && (
        <p className="text-xs" style={{ color: 'var(--color-danger)' }}>
          {missingRolesByPlatform
            .map(({ platform, role }) => `${platform.toUpperCase()} 缺少角色：${role}`)
            .join('；')}
        </p>
      )}
      {submitError && (
        <p className="text-sm rounded-lg p-3" style={{ color: 'var(--color-danger)', backgroundColor: '#fef0f0' }}>
          {submitError}
        </p>
      )}
      <button
        onClick={() => setStep('mapping')}
        disabled={!canProceedToMapping}
        className="w-full py-3 rounded-lg font-medium text-sm transition disabled:opacity-40"
        style={{ backgroundColor: 'var(--color-ink)', color: 'var(--color-card)' }}
      >
        下一步：欄位對應
      </button>
    </div>
  );
}
