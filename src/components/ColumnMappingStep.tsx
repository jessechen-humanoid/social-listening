"use client";

import { useMemo, useState } from 'react';
import type { UploadedFile } from '@/lib/types';
import type { Platform } from '@/lib/platforms';
import {
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

const ROLE_LABELS: Record<FileRole, string> = {
  hotpost: 'Hotpost（熱門貼文）',
  hotcomment: 'Hotcomment（熱門留言）',
  comments_from_posts: 'Comments-from-posts（貼文留言）',
};

export interface FileMappingState {
  fileId: string;
  role: FileRole;
  mapping: ColumnMapping;
}

export interface ConfirmedMappings {
  perFile: FileMappingState[];
  forumFilter: string[] | null; // null = no forum filter applied
}

interface ColumnMappingStepProps {
  files: UploadedFile[];
  platform: Platform;
  // Pre-filled mapping from brand memory (role -> mapping). Optional.
  memorizedMappings?: Partial<Record<FileRole, ColumnMapping>>;
  onConfirm: (result: ConfirmedMappings) => void;
  onBack?: () => void;
}

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

function computePreview(file: UploadedFile, mapping: ColumnMapping): PreviewStats {
  const data = file.data;
  const engagementCol = mapping.engagement_value;
  const postedAtCol = mapping.posted_at;

  let engagementSum = 0;
  let unparsableEngagement = 0;
  let unparsablePostedAt = 0;
  let minDate: Date | null = null;
  let maxDate: Date | null = null;

  for (const row of data) {
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

  return {
    rowCount: data.length,
    engagementSum,
    postedAtMin: minDate ? minDate.toISOString().slice(0, 10) : null,
    postedAtMax: maxDate ? maxDate.toISOString().slice(0, 10) : null,
    unparsableEngagement,
    unparsablePostedAt,
    sampleRows: data.slice(0, 5),
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
  platform,
  memorizedMappings,
  onConfirm,
  onBack,
}: ColumnMappingStepProps) {
  const initialMappings: FileMappingState[] = useMemo(() => {
    return files
      .filter((f) => f.role)
      .map((f) => {
        const role = f.role as FileRole;
        const memorized = memorizedMappings?.[role];
        const guessed = guessColumnMapping(f.columns, role, platform);
        return {
          fileId: f.id,
          role,
          mapping: { ...guessed, ...memorized },
        };
      });
  }, [files, platform, memorizedMappings]);

  const [mappings, setMappings] = useState<FileMappingState[]>(initialMappings);

  // Forum filter: only relevant for Dcard hotpost. Defaults to ["Dcard"] only.
  const dcardFile = files.find(
    (f) => f.role === 'hotpost' && rolePlatformNeedsForumFilter('hotpost', platform)
  );
  const dcardMapping = mappings.find((m) => m.fileId === dcardFile?.id);
  const allForums = useMemo(
    () => (dcardFile ? distinctForums(dcardFile, dcardMapping?.mapping.forum) : []),
    [dcardFile, dcardMapping?.mapping.forum]
  );
  const [checkedForums, setCheckedForums] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    if (allForums.includes('Dcard')) initial.add('Dcard');
    return initial;
  });

  const updateMapping = (fileId: string, field: LogicalField, value: string) => {
    setMappings((prev) =>
      prev.map((m) =>
        m.fileId === fileId
          ? { ...m, mapping: { ...m.mapping, [field]: value || undefined } }
          : m
      )
    );
  };

  const validations = useMemo(
    () =>
      mappings.map((m) => {
        const file = files.find((f) => f.id === m.fileId);
        return {
          fileId: m.fileId,
          result: file
            ? validateMapping(m.mapping, m.role, file.columns)
            : { ok: false, missing: [] },
        };
      }),
    [mappings, files]
  );

  const blocked = validations.some((v) => !v.result.ok);

  const handleConfirm = () => {
    if (blocked) return;
    onConfirm({
      perFile: mappings,
      forumFilter: dcardFile ? Array.from(checkedForums) : null,
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-medium" style={{ color: '#1a1a1a' }}>
          欄位對應
        </h3>
        <p className="text-xs mt-1" style={{ color: '#6b6b6b' }}>
          確認每個檔案的必要欄位對應；系統已依 Qsearch 慣例預填猜測值。
        </p>
      </div>

      {mappings.map((m) => {
        const file = files.find((f) => f.id === m.fileId);
        if (!file) return null;
        const validation = validations.find((v) => v.fileId === m.fileId)?.result;
        const fields = getLogicalFields(m.role).slice();
        if (rolePlatformNeedsForumFilter(m.role, platform)) {
          fields.push({ field: 'forum', required: false });
        }

        const preview = computePreview(file, m.mapping);

        return (
          <div
            key={m.fileId}
            className="rounded-xl p-5 space-y-4"
            style={{ backgroundColor: '#ffffff', border: '1px solid #e8e8e5' }}
          >
            <div>
              <span className="text-sm font-medium" style={{ color: '#1a1a1a' }}>
                {ROLE_LABELS[m.role]}
              </span>
              <span className="text-xs ml-2" style={{ color: '#6b6b6b' }}>
                {file.filename} · {file.rowCount} 列
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {fields.map(({ field, required }) => (
                <div key={field}>
                  <label className="text-xs font-medium mb-1 block" style={{ color: '#6b6b6b' }}>
                    {FIELD_LABELS[field]}
                    {required && <span style={{ color: '#c75c5c' }}> *</span>}
                  </label>
                  <select
                    value={m.mapping[field] ?? ''}
                    onChange={(e) => updateMapping(m.fileId, field, e.target.value)}
                    className="w-full rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#2d2d2d] focus:outline-none"
                    style={{
                      border: '1px solid #e8e8e5',
                      backgroundColor: '#ffffff',
                      color: '#1a1a1a',
                    }}
                  >
                    <option value="">{required ? '選擇欄位...' : '不選擇'}</option>
                    {file.columns.map((col) => (
                      <option key={col} value={col}>
                        {col}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            {validation && !validation.ok && (
              <div className="text-xs" style={{ color: '#c75c5c' }}>
                缺少必要欄位：{validation.missing.map((f) => FIELD_LABELS[f]).join('、')}
              </div>
            )}

            {/* Preview block (task 5.5) */}
            <PreviewBlock
              file={file}
              mapping={m.mapping}
              preview={preview}
            />
          </div>
        );
      })}

      {/* Dcard forum filter */}
      {dcardFile && allForums.length > 0 && (
        <div
          className="rounded-xl p-5 space-y-3"
          style={{ backgroundColor: '#ffffff', border: '1px solid #e8e8e5' }}
        >
          <div>
            <span className="text-sm font-medium" style={{ color: '#1a1a1a' }}>
              論壇過濾
            </span>
            <p className="text-xs mt-1" style={{ color: '#6b6b6b' }}>
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
                <span style={{ color: '#1a1a1a' }}>{forum}</span>
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
            style={{ color: '#6b6b6b' }}
          >
            返回
          </button>
        ) : (
          <span />
        )}
        <button
          onClick={handleConfirm}
          disabled={blocked}
          className="text-sm px-4 py-2 rounded-lg transition"
          style={{
            backgroundColor: blocked ? '#e8e8e5' : '#2d2d2d',
            color: blocked ? '#c0c0c0' : '#ffffff',
            cursor: blocked ? 'not-allowed' : 'pointer',
          }}
        >
          確認對應並繼續
        </button>
      </div>
    </div>
  );
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
          <div className="font-medium mb-1" style={{ color: '#6b6b6b' }}>
            前 {preview.sampleRows.length} 列預覽
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs" style={{ color: '#1a1a1a' }}>
              <thead>
                <tr>
                  {logicalCols.map((f) => (
                    <th
                      key={f}
                      className="text-left px-2 py-1"
                      style={{ borderBottom: '1px solid #e8e8e5', color: '#6b6b6b' }}
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
        <div style={{ color: '#c75c5c' }}>檔案中找不到任何欄位</div>
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
      <div style={{ color: '#6b6b6b' }}>{label}</div>
      <div style={{ color: warn ? '#c75c5c' : '#1a1a1a', fontWeight: 500 }}>{value}</div>
    </div>
  );
}
