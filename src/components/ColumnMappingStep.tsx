"use client";

import { useMemo, useState } from 'react';
import type { UploadedFile } from '@/lib/types';
import type { Platform } from '@/lib/platforms';
import {
  ROLE_LABELS,
  guessColumnMapping,
  validateMapping,
  rolePlatformNeedsForumFilter,
  getLogicalFields,
  type ColumnMapping,
  type FileRole,
  type LogicalField,
} from '@/lib/column-mapping';

const FIELD_LABELS: Record<LogicalField, string> = {
  content: '貼文/留言內容',
  engagement_value: '互動量',
  posted_at: '發文時間',
  post_url: '貼文 URL',
  comment_url: '留言 URL',
  parent_post_url: '所屬貼文 URL',
  forum: '論壇/來源',
  author_id: '作者 ID',
  author_name: '作者名稱',
};


// One mapping per slot (platform × role); it applies to every file the slot
// holds — headers are enforced identical at upload time.
export interface SlotMappingState {
  platform: Platform;
  role: FileRole;
  mapping: ColumnMapping;
}

export interface ConfirmedMappings {
  perSlot: SlotMappingState[];
  forumFilter: string[] | null; // null = no forum filter applied
}

interface ColumnMappingStepProps {
  files: UploadedFile[];
  // Pre-filled mapping from brand memory (role -> mapping). Optional.
  memorizedMappings?: Partial<Record<FileRole, ColumnMapping>>;
  onConfirm: (result: ConfirmedMappings) => void;
  onBack?: () => void;
}

const PLATFORM_LABELS: Record<Platform, string> = {
  fb: 'Facebook',
  ig: 'Instagram',
  threads: 'Threads',
  dcard: '論壇（Dcard）',
};

const slotKey = (platform: Platform, role: FileRole) => `${platform}:${role}`;

interface PreviewStats {
  rowCount: number;
  engagementSum: number;
  postedAtMin: string | null;
  postedAtMax: string | null;
  unparsableEngagement: number;
  unparsablePostedAt: number;
  sampleRows: Array<Record<string, unknown>>;
}

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function toDate(v: unknown): Date | null {
  if (v === null || v === undefined || v === '') return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

// Preview statistics over the union of a slot's files (spec "Multiple files
// per role slot": row count, engagement sum, and date range are merged).
function computePreview(slotFiles: UploadedFile[], mapping: ColumnMapping): PreviewStats {
  const engagementCol = mapping.engagement_value;
  const postedAtCol = mapping.posted_at;

  let rowCount = 0;
  let engagementSum = 0;
  let unparsableEngagement = 0;
  let unparsablePostedAt = 0;
  let minDate: Date | null = null;
  let maxDate: Date | null = null;

  for (const file of slotFiles) {
    rowCount += file.data.length;
    for (const row of file.data) {
      if (engagementCol) {
        const n = toNumber(row[engagementCol]);
        if (n === null) unparsableEngagement++;
        else engagementSum += n;
      }
      if (postedAtCol) {
        const d = toDate(row[postedAtCol]);
        if (d === null) {
          unparsablePostedAt++;
        } else {
          if (!minDate || d < minDate) minDate = d;
          if (!maxDate || d > maxDate) maxDate = d;
        }
      }
    }
  }

  return {
    rowCount,
    engagementSum,
    postedAtMin: minDate ? minDate.toISOString().slice(0, 10) : null,
    postedAtMax: maxDate ? maxDate.toISOString().slice(0, 10) : null,
    unparsableEngagement,
    unparsablePostedAt,
    sampleRows: slotFiles[0]?.data.slice(0, 5) ?? [],
  };
}

function distinctForums(file: UploadedFile, forumColumn: string | undefined): string[] {
  if (!forumColumn) return [];
  const seen = new Set<string>();
  for (const row of file.data) {
    const v = row[forumColumn];
    if (typeof v === 'string' && v.trim()) seen.add(v.trim());
  }
  return Array.from(seen).sort();
}

export default function ColumnMappingStep({
  files,
  memorizedMappings,
  onConfirm,
  onBack,
}: ColumnMappingStepProps) {
  // Group uploaded files into slots (platform × role); one mapping per slot,
  // guessed from the slot's first file (headers are identical within a slot).
  const slots = useMemo(() => {
    const map = new Map<string, { platform: Platform; role: FileRole; files: UploadedFile[] }>();
    for (const f of files) {
      if (!f.role || !f.platform) continue;
      const key = slotKey(f.platform, f.role);
      if (!map.has(key)) map.set(key, { platform: f.platform, role: f.role, files: [] });
      map.get(key)!.files.push(f);
    }
    return Array.from(map.values());
  }, [files]);

  const initialMappings: SlotMappingState[] = useMemo(() => {
    return slots.map((slot) => {
      const memorized = memorizedMappings?.[slot.role];
      const guessed = guessColumnMapping(slot.files[0].columns, slot.role, slot.platform);
      return {
        platform: slot.platform,
        role: slot.role,
        mapping: { ...guessed, ...memorized },
      };
    });
  }, [slots, memorizedMappings]);

  const [mappings, setMappings] = useState<SlotMappingState[]>(initialMappings);

  // Forum filter: only relevant for Dcard hotpost. Defaults to ["Dcard"] only.
  const dcardFile = files.find(
    (f) => f.role === 'hotpost' && f.platform === 'dcard'
  );
  const dcardMapping = mappings.find((m) => m.platform === 'dcard' && m.role === 'hotpost');
  const allForums = useMemo(
    () => (dcardFile ? distinctForums(dcardFile, dcardMapping?.mapping.forum) : []),
    [dcardFile, dcardMapping?.mapping.forum]
  );
  const [checkedForums, setCheckedForums] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    if (allForums.includes('Dcard')) initial.add('Dcard');
    return initial;
  });
  // The forum column may be mapped after mount; when the forum list first
  // appears, apply the default "Dcard only" selection once (render-phase
  // state adjustment — the React-sanctioned pattern for derived resets).
  const [forumListSeen, setForumListSeen] = useState(allForums.length > 0);
  if (!forumListSeen && allForums.length > 0) {
    setForumListSeen(true);
    if (allForums.includes('Dcard')) {
      setCheckedForums(new Set(['Dcard']));
    }
  }

  const updateMapping = (platform: Platform, role: FileRole, field: LogicalField, value: string) => {
    setMappings((prev) =>
      prev.map((m) =>
        m.platform === platform && m.role === role
          ? { ...m, mapping: { ...m.mapping, [field]: value || undefined } }
          : m
      )
    );
  };

  const validations = useMemo(
    () =>
      mappings.map((m) => {
        const slot = slots.find((sl) => sl.platform === m.platform && sl.role === m.role);
        return {
          key: slotKey(m.platform, m.role),
          result: slot
            ? validateMapping(m.mapping, m.role, slot.files[0].columns, m.platform)
            : { ok: false, missing: [] },
        };
      }),
    [mappings, slots]
  );

  const blocked = validations.some((v) => !v.result.ok);

  const [confirming, setConfirming] = useState(false);
  const handleConfirm = () => {
    if (blocked || confirming) return;
    setConfirming(true); // parent navigates away on success; lock prevents double-submit
    onConfirm({
      perSlot: mappings,
      forumFilter: dcardFile ? Array.from(checkedForums) : null,
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-medium" style={{ color: 'var(--color-ink)' }}>
          欄位對應
        </h3>
        <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
          確認每個檔案的必要欄位對應；系統已依 Qsearch 慣例預填猜測值。
        </p>
      </div>

      {mappings.map((m) => {
        const slot = slots.find((sl) => sl.platform === m.platform && sl.role === m.role);
        if (!slot) return null;
        const key = slotKey(m.platform, m.role);
        const validation = validations.find((v) => v.key === key)?.result;
        const fields = getLogicalFields(m.role, m.platform).slice();
        if (rolePlatformNeedsForumFilter(m.role, m.platform)) {
          fields.push({ field: 'forum', required: false });
        }

        // Cheap count for the header; the full preview scan lives in
        // SlotPreview's useMemo so it only recomputes for the edited slot.
        const slotRowCount = slot.files.reduce((n, f) => n + f.data.length, 0);
        const firstFile = slot.files[0];

        return (
          <div
            key={key}
            className="rounded-xl p-5 space-y-4"
            style={{ backgroundColor: 'var(--color-card)', border: '1px solid var(--color-line)' }}
          >
            <div>
              <span className="text-sm font-medium" style={{ color: 'var(--color-ink)' }}>
                {PLATFORM_LABELS[m.platform]}・{ROLE_LABELS[m.role]}
              </span>
              <span className="text-xs ml-2" style={{ color: 'var(--color-muted)' }}>
                {slot.files.length === 1
                  ? `${firstFile.filename} · ${slotRowCount} 列`
                  : `${slot.files.length} 個檔案合併 · 共 ${slotRowCount} 列`}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {fields.map(({ field, required }) => (
                <div key={field}>
                  <label htmlFor={`${key}-${field}`} className="text-xs font-medium mb-1 block" style={{ color: 'var(--color-muted)' }}>
                    {FIELD_LABELS[field]}
                    {required && <span style={{ color: 'var(--color-danger)' }}> *</span>}
                  </label>
                  <select
                    id={`${key}-${field}`}
                    value={m.mapping[field] ?? ''}
                    onChange={(e) => updateMapping(m.platform, m.role, field, e.target.value)}
                    className="w-full rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-accent focus:outline-none"
                    style={{
                      border: '1px solid var(--color-line)',
                      backgroundColor: 'var(--color-card)',
                      color: 'var(--color-ink)',
                    }}
                  >
                    <option value="">{required ? '選擇欄位...' : '不選擇'}</option>
                    {firstFile.columns.map((col) => (
                      <option key={col} value={col}>
                        {col}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            {validation && !validation.ok && (
              <div className="text-xs" style={{ color: 'var(--color-danger)' }}>
                缺少必要欄位：{validation.missing.map((f) => FIELD_LABELS[f]).join('、')}
              </div>
            )}

            <SlotPreview files={slot.files} mapping={m.mapping} />
          </div>
        );
      })}

      {/* Dcard forum filter */}
      {dcardFile && allForums.length > 0 && (
        <div
          className="rounded-xl p-5 space-y-3"
          style={{ backgroundColor: 'var(--color-card)', border: '1px solid var(--color-line)' }}
        >
          <div>
            <span className="text-sm font-medium" style={{ color: 'var(--color-ink)' }}>
              論壇過濾
            </span>
            <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
              預設只勾選 Dcard；其他論壇（PTT、Bahamut 等）需要時再勾選。
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            {allForums.map((forum) => (
              <label key={forum} className="text-xs flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={checkedForums.has(forum)}
                  onChange={(e) => {
                    setCheckedForums((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(forum);
                      else next.delete(forum);
                      return next;
                    });
                  }}
                />
                <span style={{ color: 'var(--color-ink)' }}>{forum}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="flex justify-between items-center pt-2">
        {onBack ? (
          <button
            onClick={onBack}
            className="text-sm px-4 py-2 rounded-lg transition"
            style={{ color: 'var(--color-muted)' }}
          >
            返回
          </button>
        ) : (
          <span />
        )}
        <button
          onClick={handleConfirm}
          disabled={blocked || confirming}
          className="text-sm px-4 py-2 rounded-lg transition"
          style={{
            backgroundColor: blocked ? 'var(--color-line)' : 'var(--color-accent)',
            color: blocked ? 'var(--color-faint)' : 'var(--color-card)',
            cursor: blocked ? 'not-allowed' : 'pointer',
          }}
        >
          確認對應並繼續
        </button>
      </div>
    </div>
  );
}

// Per-slot preview (design "前端效能五件套"): computePreview scans every row of
// the slot's files, so it recomputes only when THIS slot's files or mapping
// change — updateMapping keeps other slots' mapping references stable, so
// editing one dropdown no longer rescans every file on the page.
function SlotPreview({
  files,
  mapping,
}: {
  files: UploadedFile[];
  mapping: ColumnMapping;
}) {
  const preview = useMemo(() => computePreview(files, mapping), [files, mapping]);
  return <PreviewBlock file={files[0]} mapping={mapping} preview={preview} />;
}

function PreviewBlock({
  file,
  mapping,
  preview,
}: {
  file: UploadedFile;
  mapping: ColumnMapping;
  preview: PreviewStats;
}) {
  const logicalCols = (Object.keys(mapping) as LogicalField[]).filter(
    (f) => mapping[f]
  );

  return (
    <div className="rounded-lg p-4 text-xs space-y-3" style={{ backgroundColor: '#fafaf7' }}>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="列數" value={preview.rowCount.toLocaleString()} />
        <Stat label="互動量總和" value={preview.engagementSum.toLocaleString()} />
        <Stat
          label="發文日期範圍"
          value={
            preview.postedAtMin && preview.postedAtMax
              ? `${preview.postedAtMin} ~ ${preview.postedAtMax}`
              : '—'
          }
        />
        <Stat
          label="無法解析"
          value={
            preview.unparsableEngagement || preview.unparsablePostedAt
              ? `engagement ${preview.unparsableEngagement} / 日期 ${preview.unparsablePostedAt}`
              : '0'
          }
          warn={
            preview.unparsableEngagement > 0 || preview.unparsablePostedAt > 0
          }
        />
      </div>
      {logicalCols.length > 0 && preview.sampleRows.length > 0 && (
        <div>
          <div className="font-medium mb-1" style={{ color: 'var(--color-muted)' }}>
            前 {preview.sampleRows.length} 列預覽
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs" style={{ color: 'var(--color-ink)' }}>
              <thead>
                <tr>
                  {logicalCols.map((f) => (
                    <th
                      key={f}
                      className="text-left px-2 py-1"
                      style={{ borderBottom: '1px solid var(--color-line)', color: 'var(--color-muted)' }}
                    >
                      {FIELD_LABELS[f]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.sampleRows.map((row, idx) => (
                  <tr key={idx}>
                    {logicalCols.map((f) => {
                      const col = mapping[f];
                      const value = col ? row[col] : '';
                      const display =
                        value === null || value === undefined ? '' : String(value);
                      return (
                        <td
                          key={f}
                          className="px-2 py-1 align-top"
                          style={{ borderBottom: '1px solid #f0f0ee' }}
                        >
                          {display.length > 80 ? display.slice(0, 80) + '…' : display}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {file.columns.length === 0 && (
        <div style={{ color: 'var(--color-danger)' }}>檔案中找不到任何欄位</div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  warn,
}: {
  label: string;
  value: string;
  warn?: boolean;
}) {
  return (
    <div>
      <div style={{ color: 'var(--color-muted)' }}>{label}</div>
      <div style={{ color: warn ? 'var(--color-danger)' : 'var(--color-ink)', fontWeight: 500 }}>{value}</div>
    </div>
  );
}
