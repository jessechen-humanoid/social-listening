"use client";

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api-client';
import type { DeepAnalysisConfig, BrandSummary, PromptVersionSummary } from '@/lib/types';
import type { Platform } from '@/lib/platforms';

interface DeepConfigProps {
  config: DeepAnalysisConfig;
  onChange: (config: DeepAnalysisConfig) => void;
}

export default function DeepConfig({ config, onChange }: DeepConfigProps) {
  const [brands, setBrands] = useState<BrandSummary[]>([]);
  const [creating, setCreating] = useState(false);
  const [newBrandName, setNewBrandName] = useState('');
  const [brandError, setBrandError] = useState('');
  const [prompts, setPrompts] = useState<PromptVersionSummary[]>([]);

  useEffect(() => {
    fetch('/api/brands')
      .then((r) => r.json())
      .then((data) => setBrands(data.brands ?? []))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    fetch('/api/prompt-versions')
      .then((r) => (r.ok ? r.json() : { versions: [] }))
      .then((data) => setPrompts(data.versions ?? []))
      .catch(() => undefined);
  }, []);

  const update = <K extends keyof DeepAnalysisConfig>(key: K, value: DeepAnalysisConfig[K]) => {
    onChange({ ...config, [key]: value });
  };

  const handleSelectBrand = (brandId: string) => {
    const b = brands.find((x) => x.id === brandId);
    if (!b) return;
    onChange({ ...config, brandId: b.id, brandName: b.name });
  };

  const handleCreateBrand = async () => {
    if (!newBrandName.trim()) return;
    setCreating(true);
    setBrandError('');
    try {
      const data = await apiFetch<{ brand: { id: string; name: string; calibration_set_id?: string | null } }>(
        '/api/brands',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: newBrandName.trim() }),
        }
      );
      const summary: BrandSummary = {
        id: data.brand.id,
        name: data.brand.name,
        calibration_set_id: data.brand.calibration_set_id ?? null,
      };
      setBrands((prev) => [...prev, summary]);
      onChange({ ...config, brandId: summary.id, brandName: summary.name });
      setNewBrandName('');
    } catch (err) {
      setBrandError(err instanceof Error ? err.message : '建立品牌失敗');
    } finally {
      setCreating(false);
    }
  };

  const stageOverride = (stage: string) => config.promptVersionOverrides?.[stage] ?? '';

  const setStageOverride = (stage: string, versionId: string) => {
    const next = { ...(config.promptVersionOverrides ?? {}) };
    if (versionId) next[stage] = versionId;
    else delete next[stage];
    onChange({ ...config, promptVersionOverrides: next });
  };

  // Stages applicable to current platform
  const stagesForPlatform = (platform: Platform): string[] => {
    const all = [
      'A_related_filter',
      'A_emotion_favor',
      'B_tag_friend_filter',
      'B_emotion_favor',
      'C_emotion_favor',
    ];
    if (platform === 'fb') return all;
    return all.filter((s) => s.startsWith('A_'));
  };

  return (
    <div className="space-y-6">
      {/* Project name */}
      <div>
        <label htmlFor="deep-1" className="text-sm font-medium mb-2 block" style={{ color: 'var(--color-ink)' }}>
          專案名稱
        </label>
        <input id="deep-1"
          type="text"
          value={config.projectName}
          onChange={(e) => update('projectName', e.target.value)}
          placeholder="例如：麥當勞 2026 Q1"
          className="w-full rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-accent focus:outline-none"
          style={{ border: '1px solid var(--color-line)', backgroundColor: 'var(--color-card)' }}
        />
      </div>

      {/* Brand selection */}
      <div>
        <label htmlFor="deep-2" className="text-sm font-medium mb-2 block" style={{ color: 'var(--color-ink)' }}>
          品牌 <span style={{ color: 'var(--color-danger)' }}>*</span>
        </label>
        <div className="flex gap-2">
          <select id="deep-2"
            value={config.brandId}
            onChange={(e) => handleSelectBrand(e.target.value)}
            className="flex-1 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-accent focus:outline-none"
            style={{ border: '1px solid var(--color-line)', backgroundColor: 'var(--color-card)' }}
          >
            <option value="">選擇品牌...</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={newBrandName}
            onChange={(e) => setNewBrandName(e.target.value)}
            placeholder="新品牌名稱"
            className="flex-1 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-accent focus:outline-none"
            style={{ border: '1px solid var(--color-line)', backgroundColor: 'var(--color-card)' }}
          />
          <button
            onClick={handleCreateBrand}
            disabled={!newBrandName.trim() || creating}
            className="px-4 py-2 rounded-lg text-sm transition disabled:opacity-40"
            style={{ backgroundColor: 'var(--color-ink)', color: 'var(--color-card)' }}
          >
            新增
          </button>
        </div>
        {brandError && (
          <p className="text-xs mt-2" style={{ color: 'var(--color-danger)' }}>{brandError}</p>
        )}
      </div>

      {/* Time range */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="deep-3" className="text-sm font-medium mb-2 block" style={{ color: 'var(--color-ink)' }}>
            起始日期 <span style={{ color: 'var(--color-danger)' }}>*</span>
          </label>
          <input id="deep-3"
            type="date"
            value={config.timeRangeStart}
            onChange={(e) => update('timeRangeStart', e.target.value)}
            className="w-full rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-accent focus:outline-none"
            style={{ border: '1px solid var(--color-line)', backgroundColor: 'var(--color-card)' }}
          />
        </div>
        <div>
          <label htmlFor="deep-4" className="text-sm font-medium mb-2 block" style={{ color: 'var(--color-ink)' }}>
            結束日期 <span style={{ color: 'var(--color-danger)' }}>*</span>
          </label>
          <input id="deep-4"
            type="date"
            value={config.timeRangeEnd}
            onChange={(e) => update('timeRangeEnd', e.target.value)}
            className="w-full rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-accent focus:outline-none"
            style={{ border: '1px solid var(--color-line)', backgroundColor: 'var(--color-card)' }}
          />
        </div>
      </div>

      {/* Locked axes */}
      <div className="rounded-lg p-4" style={{ backgroundColor: '#fafaf7' }}>
        <div className="text-sm font-medium mb-2" style={{ color: 'var(--color-ink)' }}>
          評分軸（深度模式鎖定）
        </div>
        <div className="grid grid-cols-2 gap-3 text-xs" style={{ color: 'var(--color-muted)' }}>
          <div>
            <span style={{ color: 'var(--color-ink)' }}>X 軸：</span>好感度（0=完全沒有好感，10=非常支持喜歡）
          </div>
          <div>
            <span style={{ color: 'var(--color-ink)' }}>Y 軸：</span>情緒強度（0=理性冷靜，10=激情感性）
          </div>
        </div>
      </div>

      {/* Prompt version overrides */}
      {(
        <div>
          <p className="text-sm font-medium mb-2 block" style={{ color: 'var(--color-ink)' }}>
            Prompt 版本（預設使用各 stage 的 active 版本；FB 以外的平台只用 A 系列）
          </p>
          <div className="space-y-2">
            {stagesForPlatform('fb').map((stage) => {
              const versions = prompts.filter((v) => v.stage_name === stage);
              const active = versions.find((v) => v.active);
              return (
                <div key={stage} className="flex items-center gap-3">
                  <span className="text-xs font-mono w-44" style={{ color: 'var(--color-muted)' }}>
                    {stage}
                  </span>
                  <select
                    value={stageOverride(stage)}
                    onChange={(e) => setStageOverride(stage, e.target.value)}
                    className="flex-1 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-accent focus:outline-none"
                    style={{ border: '1px solid var(--color-line)', backgroundColor: 'var(--color-card)' }}
                  >
                    <option value="">
                      使用 active{active ? `（${active.version_label} · ${active.model_snapshot}）` : ''}
                    </option>
                    {versions.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.version_label} · {v.model_snapshot}
                        {v.active ? ' (active)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
