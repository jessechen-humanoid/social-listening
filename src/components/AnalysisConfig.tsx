"use client";

import type { AnalysisConfig } from '@/lib/types';

interface AnalysisConfigProps {
  config: AnalysisConfig;
  onChange: (config: AnalysisConfig) => void;
  totalRows: number;
}

const BRAND_PRESET = {
  xAxis: { name: '好感度', zeroDescription: '對品牌完全負面', tenDescription: '對品牌高度正面' },
  yAxis: { name: '情緒強度', zeroDescription: '平淡無情緒', tenDescription: '情緒非常激烈' },
};

const MODELS = [
  { value: 'gpt-4o', label: 'GPT-4o' },
  { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
  { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' },
];

const DOT_COLORS = [
  { value: '#2d2d2d', label: '炭黑' },
  { value: '#4a7c59', label: '森綠' },
  { value: '#5c6b8a', label: '石藍' },
  { value: '#8a5c5c', label: '玫粉' },
  { value: '#7a6e4e', label: '橄欖' },
  { value: '#6b5c8a', label: '霧紫' },
  { value: '#5c8a8a', label: '青碧' },
  { value: '#8a7a5c', label: '暖卡' },
];

export default function AnalysisConfigPanel({ config, onChange, totalRows }: AnalysisConfigProps) {
  const isBrand = config.mode === 'brand';

  const setField = <K extends keyof AnalysisConfig>(key: K, value: AnalysisConfig[K]) => {
    onChange({ ...config, [key]: value });
  };

  const switchMode = (mode: 'brand' | 'custom') => {
    if (mode === 'brand') {
      onChange({ ...config, mode, xAxis: BRAND_PRESET.xAxis, yAxis: BRAND_PRESET.yAxis });
    } else {
      onChange({ ...config, mode });
    }
  };

  const effectiveMaxRows = config.maxRows > 0 ? config.maxRows : totalRows;

  return (
    <div className="space-y-5">
      {/* Project name */}
      <div>
        <label className="text-sm font-medium block mb-2" style={{ color: '#6b6b6b' }}>專案名稱（選填）</label>
        <input
          type="text"
          value={config.projectName}
          onChange={e => setField('projectName', e.target.value)}
          placeholder="例如：McDonald's Q1 2026"
          className="w-full rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#2d2d2d] focus:outline-none"
          style={{ border: '1px solid #e8e8e5', backgroundColor: '#ffffff', color: '#1a1a1a' }}
        />
      </div>

      {/* Mode toggle */}
      <div>
        <label className="text-sm font-medium block mb-2" style={{ color: '#6b6b6b' }}>分析模式</label>
        <div className="flex gap-2">
          <button
            onClick={() => switchMode('brand')}
            className="px-4 py-2 rounded-lg text-sm font-medium transition"
            style={isBrand
              ? { backgroundColor: '#1a1a1a', color: '#ffffff' }
              : { backgroundColor: '#f5f5f3', color: '#1a1a1a' }
            }
          >
            品牌好感
          </button>
          <button
            onClick={() => switchMode('custom')}
            className="px-4 py-2 rounded-lg text-sm font-medium transition"
            style={!isBrand
              ? { backgroundColor: '#1a1a1a', color: '#ffffff' }
              : { backgroundColor: '#f5f5f3', color: '#1a1a1a' }
            }
          >
            自訂模式
          </button>
        </div>
      </div>

      {/* Condition indicator */}
      <div className="rounded-xl p-5" style={{ backgroundColor: '#ffffff', border: '1px solid #e8e8e5' }}>
        <label className="text-sm font-medium block mb-1" style={{ color: '#1a1a1a' }}>條件指標（選填）</label>
        <p className="text-xs mb-3" style={{ color: '#6b6b6b' }}>
          AI 會針對每則內容判斷是否符合此條件，例如「內容是否與早餐趨勢有關」
        </p>
        <input
          type="text"
          value={config.conditionText}
          onChange={e => setField('conditionText', e.target.value)}
          placeholder="輸入條件描述..."
          className="w-full rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#2d2d2d] focus:outline-none"
          style={{ border: '1px solid #e8e8e5', backgroundColor: '#ffffff', color: '#1a1a1a' }}
        />
        {config.conditionText && (
          <label className="flex items-center gap-2 mt-3 text-sm cursor-pointer" style={{ color: '#1a1a1a' }}>
            <input
              type="checkbox"
              checked={config.conditionFilterEnabled}
              onChange={e => setField('conditionFilterEnabled', e.target.checked)}
              className="w-4 h-4 accent-[#2d2d2d]"
            />
            啟用篩選（僅分析符合條件的內容）
          </label>
        )}
      </div>

      {/* X Axis */}
      <AxisConfigSection
        label="X 軸定義"
        axis={config.xAxis}
        locked={isBrand}
        onChange={axis => setField('xAxis', axis)}
      />

      {/* Y Axis */}
      <AxisConfigSection
        label="Y 軸定義"
        axis={config.yAxis}
        locked={isBrand}
        onChange={axis => setField('yAxis', axis)}
      />

      {/* Dot color selector */}
      <div>
        <label className="text-sm font-medium block mb-2" style={{ color: '#6b6b6b' }}>散佈圖顏色</label>
        <div className="flex gap-3 flex-wrap">
          {DOT_COLORS.map(c => (
            <button
              key={c.value}
              onClick={() => setField('dotColor', c.value)}
              className="w-8 h-8 rounded-full transition"
              title={c.label}
              style={{
                backgroundColor: c.value,
                border: config.dotColor === c.value ? '3px solid #1a1a1a' : '3px solid transparent',
                outline: config.dotColor === c.value ? '2px solid #e8e8e5' : 'none',
              }}
            />
          ))}
        </div>
      </div>

      {/* Row count slider */}
      {totalRows > 0 && (
        <div>
          <label className="text-sm font-medium block mb-2" style={{ color: '#6b6b6b' }}>
            分析筆數：{effectiveMaxRows} / {totalRows}
          </label>
          <input
            type="range"
            min={1}
            max={totalRows}
            value={effectiveMaxRows}
            onChange={e => setField('maxRows', parseInt(e.target.value))}
            className="w-full accent-[#2d2d2d]"
          />
        </div>
      )}

      {/* Model selection */}
      <div>
        <label className="text-sm font-medium block mb-2" style={{ color: '#6b6b6b' }}>AI 模型</label>
        <select
          value={config.model}
          onChange={e => setField('model', e.target.value)}
          className="w-full rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#2d2d2d] focus:outline-none"
          style={{ border: '1px solid #e8e8e5', backgroundColor: '#ffffff', color: '#1a1a1a' }}
        >
          {MODELS.map(m => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

function AxisConfigSection({
  label,
  axis,
  locked,
  onChange,
}: {
  label: string;
  axis: { name: string; zeroDescription: string; tenDescription: string };
  locked: boolean;
  onChange: (axis: { name: string; zeroDescription: string; tenDescription: string }) => void;
}) {
  return (
    <div className="rounded-xl p-5" style={{ backgroundColor: '#ffffff', border: '1px solid #e8e8e5' }}>
      <label className="text-sm font-medium block mb-3" style={{ color: '#1a1a1a' }}>
        {label}
        {locked && <span className="text-xs ml-2" style={{ color: '#6b6b6b' }}>（預設模式已鎖定）</span>}
      </label>
      <div className="space-y-3">
        <div>
          <label className="text-xs font-medium block mb-1" style={{ color: '#6b6b6b' }}>名稱</label>
          <input
            type="text"
            value={axis.name}
            onChange={e => onChange({ ...axis, name: e.target.value })}
            disabled={locked}
            className="w-full rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#2d2d2d] focus:outline-none disabled:opacity-60"
            style={{ border: '1px solid #e8e8e5', backgroundColor: locked ? '#f5f5f3' : '#ffffff', color: '#1a1a1a' }}
          />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium block mb-1" style={{ color: '#6b6b6b' }}>0 分代表</label>
            <input
              type="text"
              value={axis.zeroDescription}
              onChange={e => onChange({ ...axis, zeroDescription: e.target.value })}
              disabled={locked}
              className="w-full rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#2d2d2d] focus:outline-none disabled:opacity-60"
              style={{ border: '1px solid #e8e8e5', backgroundColor: locked ? '#f5f5f3' : '#ffffff', color: '#1a1a1a' }}
            />
          </div>
          <div>
            <label className="text-xs font-medium block mb-1" style={{ color: '#6b6b6b' }}>10 分代表</label>
            <input
              type="text"
              value={axis.tenDescription}
              onChange={e => onChange({ ...axis, tenDescription: e.target.value })}
              disabled={locked}
              className="w-full rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#2d2d2d] focus:outline-none disabled:opacity-60"
              style={{ border: '1px solid #e8e8e5', backgroundColor: locked ? '#f5f5f3' : '#ffffff', color: '#1a1a1a' }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
