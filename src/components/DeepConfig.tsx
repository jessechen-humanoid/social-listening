"use client";

import { useEffect, useState } from 'react';
import type { DeepAnalysisConfig, BrandSummary, PromptVersionSummary } from '@/lib/types';
import type { Platform } from '@/lib/brands';

const PLATFORMS: Array<{ value: Platform; label: string }> = [
  { value: 'fb', label: 'Facebook' },
  { value: 'ig', label: 'Instagram' },
  { value: 'threads', label: 'Threads' },
  { value: 'dcard', label: 'Dcard' },
];

interface DeepConfigProps {
  config: DeepAnalysisConfig;
  onChange: (config: DeepAnalysisConfig) => void;
}

export default function DeepConfig({ config, onChange }: DeepConfigProps) {
  const [brands, setBrands] = useState<BrandSummary[]>([]);
  const [creating, setCreating] = useState(false);
  const [newBrandName, setNewBrandName] = useState('');
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
    try {
      const res = await fetch('/api/brands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newBrandName.trim() }),
      });
      const data = await res.json();
      if (data.brand) {
        const summary: BrandSummary = {
          id: data.brand.id,
          name: data.brand.name,
          calibration_set_id: data.brand.calibration_set_id ?? null,
        };
        setBrands((prev) => [...prev, summary]);
        onChange({ ...config, brandId: summary.id, brandName: summary.name });
        setNewBrandName('');
      } else {
        alert(data.error ?? '建立品牌失敗');
      }
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
        <label className="text-sm font-medium mb-2 block" style={{ color: '#1a1a1a' }}>
          專案名稱
        </label>
        <input
          type="text"
          value={config.projectName}
          onChange={(e) => update('projectName', e.target.value)}
          placeholder="例如：麥當勞 2026 Q1"
          className="w-full rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#2d2d2d] focus:outline-none"
          style={{ border: '1px solid #e8e8e5', backgroundColor: '#ffffff' }}
        />
      </div>

      {/* Brand selection */}
      <div>
        <label className="text-sm font-medium mb-2 block" style={{ color: '#1a1a1a' }}>
          品牌 <span style={{ color: '#c75c5c' }}>*</span>
        </label>
        <div className="flex gap-2">
          <select
            value={config.brandId}
            onChange={(e) => handleSelectBrand(e.target.value)}
            className="flex-1 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#2d2d2d] focus:outline-none"
            style={{ border: '1px solid #e8e8e5', backgroundColor: '#ffffff' }}
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
            className="flex-1 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#2d2d2d] focus:outline-none"
            style={{ border: '1px solid #e8e8e5', backgroundColor: '#ffffff' }}
          />
          <button
            onClick={handleCreateBrand}
            disabled={!newBrandName.trim() || creating}
            className="px-4 py-2 rounded-lg text-sm transition disabled:opacity-40"
            style={{ backgroundColor: '#1a1a1a', color: '#ffffff' }}
          >
            新增
          </button>
        </div>
      </div>

      {/* Platform */}
      <div>
        <label className="text-sm font-medium mb-2 block" style={{ color: '#1a1a1a' }}>
          平台 <span style={{ color: '#c75c5c' }}>*</span>
        </label>
        <div className="flex gap-2">
          {PLATFORMS.map((p) => (
            <button
              key={p.value}
              onClick={() => update('platform', p.value)}
              className="flex-1 px-3 py-2 rounded-lg text-sm transition"
              style={
                config.platform === p.value
                  ? { backgroundColor: '#1a1a1a', color: '#ffffff' }
                  : {
                      backgroundColor: '#ffffff',
                      color: '#6b6b6b',
                      border: '1px solid #e8e8e5',
                    }
              }
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Time range */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-sm font-medium mb-2 block" style={{ color: '#1a1a1a' }}>
            起始日期 <span style={{ color: '#c75c5c' }}>*</span>
          </label>
          <input
            type="date"
            value={config.timeRangeStart}
            onChange={(e) => update('timeRangeStart', e.target.value)}
            className="w-full rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#2d2d2d] focus:outline-none"
            style={{ border: '1px solid #e8e8e5', backgroundColor: '#ffffff' }}
          />
        </div>
        <div>
          <label className="text-sm font-medium mb-2 block" style={{ color: '#1a1a1a' }}>
            結束日期 <span style={{ color: '#c75c5c' }}>*</span>
          </label>
          <input
            type="date"
            value={config.timeRangeEnd}
            onChange={(e) => update('timeRangeEnd', e.target.value)}
            className="w-full rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#2d2d2d] focus:outline-none"
            style={{ border: '1px solid #e8e8e5', backgroundColor: '#ffffff' }}
          />
        </div>
      </div>

      {/* Locked axes */}
      <div className="rounded-lg p-4" style={{ backgroundColor: '#fafaf7' }}>
        <div className="text-sm font-medium mb-2" style={{ color: '#1a1a1a' }}>
          評分軸（深度模式鎖定）
        </div>
        <div className="grid grid-cols-2 gap-3 text-xs" style={{ color: '#6b6b6b' }}>
          <div>
            <span style={{ color: '#1a1a1a' }}>X 軸：</span>好感度（0=完全沒有好感，10=非常支持喜歡）
          </div>
          <div>
            <span style={{ color: '#1a1a1a' }}>Y 軸：</span>情緒強度（0=理性冷靜，10=激情感性）
          </div>
        </div>
      </div>

      {/* Prompt version overrides */}
      {config.platform && (
        <div>
          <label className="text-sm font-medium mb-2 block" style={{ color: '#1a1a1a' }}>
            Prompt 版本（預設使用各 stage 的 active 版本）
          </label>
          <div className="space-y-2">
            {stagesForPlatform(config.platform).map((stage) => {
              const versions = prompts.filter((v) => v.stage_name === stage);
              const active = versions.find((v) => v.active);
              return (
                <div key={stage} className="flex items-center gap-3">
                  <span className="text-xs font-mono w-44" style={{ color: '#6b6b6b' }}>
                    {stage}
                  </span>
                  <select
                    value={stageOverride(stage)}
                    onChange={(e) => setStageOverride(stage, e.target.value)}
                    className="flex-1 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-[#2d2d2d] focus:outline-none"
                    style={{ border: '1px solid #e8e8e5', backgroundColor: '#ffffff' }}
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
