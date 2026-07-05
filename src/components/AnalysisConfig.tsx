"use client";

import { LIGHT_MODELS } from '@/lib/analysis-models';
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

const MODELS = LIGHT_MODELS;

const DOT_COLORS = [
  { value: '#404040', label: '深灰' },
  { value: '#E85D3A', label: '橘紅' },
  { value: '#F5A0A0', label: '粉紅' },
  { value: '#1A8C8C', label: '深藍綠' },
  { value: '#00CED1', label: '藍綠' },
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
        <label htmlFor="light-1" className="text-sm font-medium block mb-2" style={{ color: 'var(--color-muted)' }}>專案名稱（選填）</label>
        <input id="light-1"
          type="text"
          value={config.projectName}
          onChange={e => setField('projectName', e.target.value)}
          placeholder="例如：McDonald's Q1 2026"
          className="w-full rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-accent focus:outline-none"
          style={{ border: '1px solid var(--color-line)', backgroundColor: 'var(--color-card)', color: 'var(--color-ink)' }}
        />
      </div>

      {/* Mode toggle */}
      <div>
        <p className="text-sm font-medium block mb-2" style={{ color: 'var(--color-muted)' }}>分析模式</p>
        <div className="flex gap-2">
          <button
            onClick={() => switchMode('brand')}
            className="px-4 py-2 rounded-lg text-sm font-medium transition"
            style={isBrand
              ? { backgroundColor: 'var(--color-ink)', color: 'var(--color-card)' }
              : { backgroundColor: '#f5f5f3', color: 'var(--color-ink)' }
            }
          >
            品牌好感
          </button>
          <button
            onClick={() => switchMode('custom')}
            className="px-4 py-2 rounded-lg text-sm font-medium transition"
            style={!isBrand
              ? { backgroundColor: 'var(--color-ink)', color: 'var(--color-card)' }
              : { backgroundColor: '#f5f5f3', color: 'var(--color-ink)' }
            }
          >
            自訂模式
          </button>
        </div>
      </div>

      {/* Condition indicator */}
      <div className="rounded-xl p-5" style={{ backgroundColor: 'var(--color-card)', border: '1px solid var(--color-line)' }}>
        <label htmlFor="light-condition" className="text-sm font-medium block mb-1" style={{ color: 'var(--color-ink)' }}>條件指標（選填）</label>
        <p className="text-xs mb-3" style={{ color: 'var(--color-muted)' }}>
          AI 會針對每則內容判斷是否符合此條件，例如「內容是否與早餐趨勢有關」
        </p>
        <input
          id="light-condition"
          type="text"
          value={config.conditionText}
          onChange={e => setField('conditionText', e.target.value)}
          placeholder="輸入條件描述..."
          className="w-full rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-accent focus:outline-none"
          style={{ border: '1px solid var(--color-line)', backgroundColor: 'var(--color-card)', color: 'var(--color-ink)' }}
        />
        {config.conditionText && (
          <label className="flex items-center gap-2 mt-3 text-sm cursor-pointer" style={{ color: 'var(--color-ink)' }}>
            <input
              type="checkbox"
              checked={config.conditionFilterEnabled}
              onChange={e => setField('conditionFilterEnabled', e.target.checked)}
              className="w-4 h-4 accent-accent"
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
        <p className="text-sm font-medium block mb-2" style={{ color: 'var(--color-muted)' }}>散佈圖顏色</p>
        <div className="flex gap-3 flex-wrap">
          {DOT_COLORS.map(c => (
            <button
              key={c.value}
              onClick={() => setField('dotColor', c.value)}
              className="w-8 h-8 rounded-full transition"
              title={c.label}
              style={{
                backgroundColor: c.value,
                border: config.dotColor === c.value ? '3px solid var(--color-ink)' : '3px solid transparent',
                outline: config.dotColor === c.value ? '2px solid var(--color-line)' : 'none',
              }}
            />
          ))}
        </div>
      </div>

      {/* Model selection */}
      <div>
        <label htmlFor="light-2" className="text-sm font-medium block mb-2" style={{ color: 'var(--color-muted)' }}>AI 模型</label>
        <select id="light-2"
          value={config.model}
          onChange={e => setField('model', e.target.value)}
          className="w-full rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-accent focus:outline-none"
          style={{ border: '1px solid var(--color-line)', backgroundColor: 'var(--color-card)', color: 'var(--color-ink)' }}
        >
          {MODELS.map(m => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
      </div>

      {/* Row count slider — positioned just before "start analysis" button */}
      {totalRows > 0 && (
        <div>
          <label className="text-sm font-medium block mb-2" style={{ color: 'var(--color-muted)' }}>
            分析筆數：{effectiveMaxRows} / {totalRows}
          </label>
          <input
            type="range"
            min={1}
            max={totalRows}
            value={effectiveMaxRows}
            onChange={e => setField('maxRows', parseInt(e.target.value))}
            className="w-full accent-[#404040]"
          />
        </div>
      )}
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
    <div className="rounded-xl p-5" style={{ backgroundColor: 'var(--color-card)', border: '1px solid var(--color-line)' }}>
      <p className="text-sm font-medium block mb-3" style={{ color: 'var(--color-ink)' }}>
        {label}
        {locked && <span className="text-xs ml-2" style={{ color: 'var(--color-muted)' }}>（預設模式已鎖定）</span>}
      </p>
      <div className="space-y-3">
        <div>
          <label htmlFor={`${label}-name`} className="text-xs font-medium block mb-1" style={{ color: 'var(--color-muted)' }}>名稱</label>
          <input id={`${label}-name`}
            type="text"
            value={axis.name}
            onChange={e => onChange({ ...axis, name: e.target.value })}
            disabled={locked}
            className="w-full rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-accent focus:outline-none disabled:opacity-60"
            style={{ border: '1px solid var(--color-line)', backgroundColor: locked ? '#f5f5f3' : 'var(--color-card)', color: 'var(--color-ink)' }}
          />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label htmlFor={`${label}-zero`} className="text-xs font-medium block mb-1" style={{ color: 'var(--color-muted)' }}>0 分代表</label>
            <input id={`${label}-zero`}
              type="text"
              value={axis.zeroDescription}
              onChange={e => onChange({ ...axis, zeroDescription: e.target.value })}
              disabled={locked}
              className="w-full rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-accent focus:outline-none disabled:opacity-60"
              style={{ border: '1px solid var(--color-line)', backgroundColor: locked ? '#f5f5f3' : 'var(--color-card)', color: 'var(--color-ink)' }}
            />
          </div>
          <div>
            <label htmlFor={`${label}-ten`} className="text-xs font-medium block mb-1" style={{ color: 'var(--color-muted)' }}>10 分代表</label>
            <input id={`${label}-ten`}
              type="text"
              value={axis.tenDescription}
              onChange={e => onChange({ ...axis, tenDescription: e.target.value })}
              disabled={locked}
              className="w-full rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-accent focus:outline-none disabled:opacity-60"
              style={{ border: '1px solid var(--color-line)', backgroundColor: locked ? '#f5f5f3' : 'var(--color-card)', color: 'var(--color-ink)' }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
