"use client";

import { useCallback, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { parseFile } from '@/lib/parse-file';
import type { UploadedFile } from '@/lib/types';
import { ROLE_LABELS } from '@/lib/column-mapping';
import type { FileRole } from '@/lib/column-mapping';
import { SUPPORTED_PLATFORMS, type Platform } from '@/lib/platforms';
import { compareHeaderSets, describeHeaderMismatch } from '@/lib/header-compare';

type Mode = 'light' | 'deep';

interface FileUploadProps {
  files: UploadedFile[];
  onChange: (files: UploadedFile[]) => void;
  // Deep mode renders one section per platform (FB three role slots, others
  // one hotpost slot), all optional — upload everything for the quarter at once.
  // Light mode (default) keeps the existing free-form upload + inline column dropdowns.
  mode?: Mode;
}


function rolesForPlatform(platform: Platform): FileRole[] {
  if (platform === 'fb') {
    return ['hotpost', 'hotcomment', 'comments_from_posts'];
  }
  return ['hotpost'];
}

// Qsearch multi-sheet workbooks name their sheets by platform; pick the sheet
// matching the task's platform by default (fb→FB, dcard→FORUM, case-insensitive).
const PLATFORM_LABELS: Record<Platform, string> = {
  fb: 'Facebook',
  ig: 'Instagram',
  threads: 'Threads',
  dcard: '論壇（Dcard）',
};

const PLATFORM_SHEET_ALIASES: Record<Platform, string[]> = {
  fb: ['fb', 'facebook'],
  ig: ['ig', 'instagram'],
  threads: ['threads'],
  dcard: ['forum', 'dcard'],
};

function defaultSheetForPlatform(sheetNames: string[], platform?: Platform): string | undefined {
  if (!platform) return undefined;
  const aliases = PLATFORM_SHEET_ALIASES[platform] ?? [];
  return sheetNames.find(s => aliases.includes(s.toLowerCase()));
}

async function buildUploadedFile(
  file: File,
  role?: FileRole,
  platform?: Platform,
  sheetName?: string
): Promise<UploadedFile> {
  let parsed = await parseFile(file, sheetName);
  if (!sheetName && parsed.sheetNames.length > 1) {
    const preferred = defaultSheetForPlatform(parsed.sheetNames, platform);
    if (preferred && preferred !== parsed.selectedSheet) {
      parsed = await parseFile(file, preferred);
    }
  }
  const cols = parsed.columns;
  const autoContent = cols.find(c => c.toLowerCase().includes('content')) || '';
  const autoEngagement = cols.find(c => c.toLowerCase().includes('like_count')) || '';
  return {
    id: uuidv4(),
    file,
    filename: file.name,
    columns: cols,
    rowCount: parsed.rowCount,
    contentColumn: autoContent,
    engagementColumn: autoEngagement,
    data: parsed.data,
    role,
    sheetNames: parsed.sheetNames,
    selectedSheet: parsed.selectedSheet,
  };
}

export default function FileUpload({ files, onChange, mode = 'light' }: FileUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  // Parsing runs off the main thread (Papa worker) — surface it, or large
  // files look like a dead click. Keyed per slot in deep mode.
  const [parsingSlots, setParsingSlots] = useState<Set<string>>(new Set());
  const [parsingLight, setParsingLight] = useState(false);
  // Inline upload errors (spec "Inline error feedback replaces alert
  // dialogs"): collected per action, rendered as a banner, cleared on the
  // next upload attempt.
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);

  const handleFiles = useCallback(async (fileList: FileList) => {
    const newFiles: UploadedFile[] = [];
    const errors: string[] = [];

    setUploadErrors([]);
    setParsingLight(true);
    try {
      for (const file of Array.from(fileList)) {
        const ext = file.name.split('.').pop()?.toLowerCase();
        if (!ext || !['csv', 'xlsx', 'xls'].includes(ext)) {
          errors.push(`${file.name}：不支援的格式，請上傳 CSV 或 Excel (.xlsx) 檔案`);
          continue;
        }

        try {
          newFiles.push(await buildUploadedFile(file));
        } catch (err) {
          errors.push(`${file.name}：${err instanceof Error ? err.message : '檔案解析失敗'}`);
        }
      }
    } finally {
      setParsingLight(false);
    }

    setUploadErrors(errors);
    onChange([...files, ...newFiles]);
  }, [files, onChange]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  }, [handleFiles]);

  const handleRemove = useCallback((id: string) => {
    onChange(files.filter(f => f.id !== id));
  }, [files, onChange]);

  const handleColumnChange = useCallback((id: string, field: 'contentColumn' | 'engagementColumn', value: string) => {
    onChange(files.map(f => f.id === id ? { ...f, [field]: value } : f));
  }, [files, onChange]);

  // One batch per drop/selection with a single onChange at the end: per-file
  // onChange calls would each spread the same stale `files` snapshot, so a
  // multi-file drop would keep only the last file once parses overlap.
  const handleSlotUpload = useCallback(async (platform: Platform, role: FileRole, dropped: File[]) => {
    const slotId = `${platform}:${role}`;
    setUploadErrors([]);
    setParsingSlots(prev => new Set(prev).add(slotId));
    const accepted: UploadedFile[] = [];
    const errors: string[] = [];
    try {
      for (const file of dropped) {
        const ext = file.name.split('.').pop()?.toLowerCase();
        if (!ext || !['csv', 'xlsx', 'xls'].includes(ext)) {
          errors.push(`${file.name}：不支援的格式，請上傳 CSV 或 Excel (.xlsx) 檔案`);
          continue;
        }
        try {
          const uploaded = { ...(await buildUploadedFile(file, role, platform)), platform };
          // Multi-file slot (Qsearch split exports): all files in a slot share one
          // column mapping, so headers must match the slot's first file exactly.
          const reference =
            files.find(f => f.platform === platform && f.role === role) ?? accepted[0];
          if (reference) {
            const cmp = compareHeaderSets(reference.columns, uploaded.columns);
            if (!cmp.same) {
              errors.push(
                `${file.name} 的欄位與 ${reference.filename} 不一致，無法放入同一槽位。${describeHeaderMismatch(cmp)}`
              );
              continue;
            }
          }
          accepted.push(uploaded);
        } catch (err) {
          errors.push(`${file.name}：${err instanceof Error ? err.message : '檔案解析失敗'}`);
        }
      }
    } finally {
      setParsingSlots(prev => {
        const next = new Set(prev);
        next.delete(slotId);
        return next;
      });
    }
    setUploadErrors(errors);
    if (accepted.length > 0) onChange([...files, ...accepted]);
  }, [files, onChange]);

  // Multi-sheet workbooks: re-parse the original file with the chosen sheet,
  // keeping the same UploadedFile id so downstream mapping state stays attached.
  const handleSheetChange = useCallback(async (id: string, sheetName: string) => {
    const existing = files.find(f => f.id === id);
    if (!existing) return;
    try {
      const reparsed = await buildUploadedFile(existing.file, existing.role, existing.platform, sheetName);
      onChange(files.map(f => (f.id === id ? { ...reparsed, id, platform: existing.platform } : f)));
    } catch (err) {
      setUploadErrors([err instanceof Error ? err.message : '工作表切換失敗']);
    }
  }, [files, onChange]);

  if (mode === 'deep') {
    return (
      <div className="space-y-6">
        <p className="text-sm font-medium" style={{ color: 'var(--color-muted)' }}>
          資料檔案（各平台皆可留空；有檔案的平台會各自建立一個分析任務）
        </p>
      {uploadErrors.length > 0 && (
        <div className="rounded-lg p-3 text-xs space-y-1" style={{ backgroundColor: '#fef0f0', color: 'var(--color-danger)' }}>
          {uploadErrors.map((msg, i) => <p key={i}>{msg}</p>)}
        </div>
      )}
        {SUPPORTED_PLATFORMS.map(platform => {
          const sectionFiles = files.filter(f => f.platform === platform);
          return (
            <div key={platform} className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium" style={{ color: 'var(--color-ink)' }}>
                  {PLATFORM_LABELS[platform]}
                </span>
                {sectionFiles.length > 0 && (
                  <span className="text-xs" style={{ color: 'var(--color-success)' }}>
                    {sectionFiles.length} 個檔案
                  </span>
                )}
              </div>
              {rolesForPlatform(platform).map(role => (
                <RoleSlot
                  key={`${platform}-${role}`}
                  platform={platform}
                  role={role}
                  files={sectionFiles.filter(f => f.role === role)}
                  parsing={parsingSlots.has(`${platform}:${role}`)}
                  onUpload={handleSlotUpload}
                  onRemove={handleRemove}
                  onSheetChange={handleSheetChange}
                />
              ))}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm font-medium" style={{ color: 'var(--color-muted)' }}>資料檔案</p>
      {uploadErrors.length > 0 && (
        <div className="rounded-lg p-3 text-xs space-y-1" style={{ backgroundColor: '#fef0f0', color: 'var(--color-danger)' }}>
          {uploadErrors.map((msg, i) => <p key={i}>{msg}</p>)}
        </div>
      )}

      {/* Drop zone */}
      <div
        role="button"
        tabIndex={0}
        aria-label="上傳資料檔案"
        className="rounded-xl p-8 text-center cursor-pointer transition"
        style={{ border: '2px dashed var(--color-line)', backgroundColor: 'var(--color-card)' }}
        onDragOver={e => e.preventDefault()}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click(); }
        }}
      >
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
          {parsingLight ? '解析中…' : '拖放檔案至此，或點擊上傳'}
        </p>
        <p className="text-xs mt-1" style={{ color: 'var(--color-faint)' }}>
          支援 CSV、Excel (.xlsx)
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          multiple
          className="hidden"
          onChange={e => {
            if (e.target.files) handleFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {/* File list */}
      {files.map(f => (
        <div
          key={f.id}
          className="rounded-xl p-5"
          style={{ backgroundColor: 'var(--color-card)', border: '1px solid var(--color-line)' }}
        >
          <div className="flex items-center justify-between mb-3">
            <div>
              <span className="text-sm font-medium" style={{ color: 'var(--color-ink)' }}>{f.filename}</span>
              <span className="text-xs ml-2" style={{ color: 'var(--color-muted)' }}>{f.rowCount} 列</span>
            </div>
            <button
              onClick={() => handleRemove(f.id)}
              className="text-sm px-2 py-1 rounded-lg transition"
              style={{ color: 'var(--color-danger)' }}
            >
              移除
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Content column - required */}
            <div>
              <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--color-muted)' }}>
                分析內容欄位 <span style={{ color: 'var(--color-danger)' }}>*</span>
              </label>
              <select
                value={f.contentColumn}
                onChange={e => handleColumnChange(f.id, 'contentColumn', e.target.value)}
                className="w-full rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-accent focus:outline-none"
                style={{ border: '1px solid var(--color-line)', backgroundColor: 'var(--color-card)', color: 'var(--color-ink)' }}
              >
                <option value="">選擇欄位...</option>
                {f.columns.map(col => (
                  <option key={col} value={col}>{col}</option>
                ))}
              </select>
            </div>

            {/* Engagement column - optional */}
            <div>
              <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--color-muted)' }}>
                互動量欄位（選填）
              </label>
              <select
                value={f.engagementColumn}
                onChange={e => handleColumnChange(f.id, 'engagementColumn', e.target.value)}
                className="w-full rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-accent focus:outline-none"
                style={{ border: '1px solid var(--color-line)', backgroundColor: 'var(--color-card)', color: 'var(--color-ink)' }}
              >
                <option value="">不選擇</option>
                {f.columns.map(col => (
                  <option key={col} value={col}>{col}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

interface RoleSlotProps {
  platform: Platform;
  role: FileRole;
  files: UploadedFile[];
  parsing: boolean;
  onUpload: (platform: Platform, role: FileRole, files: File[]) => void;
  onRemove: (id: string) => void;
  onSheetChange: (id: string, sheetName: string) => void;
}

function RoleSlot({ platform, role, files, parsing, onUpload, onRemove, onSheetChange }: RoleSlotProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    // Multi-file slot: accept every dropped file (Qsearch split exports).
    onUpload(platform, role, Array.from(e.dataTransfer.files));
  };

  return (
    <div
      className="rounded-xl p-5"
      style={{ backgroundColor: 'var(--color-card)', border: '1px solid var(--color-line)' }}
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium" style={{ color: 'var(--color-ink)' }}>
          {ROLE_LABELS[role]}
          {files.length > 1 && (
            <span className="text-xs ml-2" style={{ color: 'var(--color-muted)' }}>
              {files.length} 個檔案（將合併分析）
            </span>
          )}
        </span>
      </div>

      {files.map(file => (
        <div
          key={file.id}
          className="flex items-center justify-between rounded-lg px-3 py-2 mb-2"
          style={{ backgroundColor: 'var(--color-paper)', border: '1px solid var(--color-line-soft)' }}
        >
          <div className="text-xs space-y-1" style={{ color: 'var(--color-muted)' }}>
            <div style={{ color: 'var(--color-ink)' }}>{file.filename}</div>
            <div>{file.rowCount} 列 · {file.columns.length} 個欄位</div>
            {(file.sheetNames?.length ?? 0) > 1 && (
              <div className="flex items-center gap-2">
                <label htmlFor={`sheet-${file.id}`} className="text-xs" style={{ color: 'var(--color-muted)' }}>工作表</label>
                <select
                  id={`sheet-${file.id}`}
                  value={file.selectedSheet ?? ''}
                  onChange={e => onSheetChange(file.id, e.target.value)}
                  className="rounded-lg px-2 py-1 text-xs focus:ring-2 focus:ring-accent focus:outline-none"
                  style={{ border: '1px solid var(--color-line)', backgroundColor: 'var(--color-card)', color: 'var(--color-ink)' }}
                >
                  {file.sheetNames!.map(name => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <button
            onClick={() => onRemove(file.id)}
            className="text-sm px-2 py-1 rounded-lg transition"
            style={{ color: 'var(--color-danger)' }}
          >
            移除
          </button>
        </div>
      ))}

      <div
        role="button"
        tabIndex={0}
        aria-label={`上傳 ${ROLE_LABELS[role]} 檔案`}
        aria-disabled={parsing}
        className="rounded-lg p-4 text-center transition"
        style={{
          border: '2px dashed var(--color-line)',
          cursor: parsing ? 'wait' : 'pointer',
          opacity: parsing ? 0.6 : 1,
        }}
        onDragOver={e => e.preventDefault()}
        onDrop={parsing ? e => e.preventDefault() : handleDrop}
        onClick={() => { if (!parsing) inputRef.current?.click(); }}
        onKeyDown={e => {
          if (!parsing && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); inputRef.current?.click(); }
        }}
      >
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
          {parsing
            ? '解析中…'
            : files.length === 0 ? '拖放檔案至此，或點擊上傳' : '加入更多分割檔（欄位須相同）'}
        </p>
        <p className="text-xs mt-1" style={{ color: 'var(--color-faint)' }}>
          支援 CSV、Excel (.xlsx)，可多檔
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          multiple
          className="hidden"
          onChange={e => {
            onUpload(platform, role, Array.from(e.target.files ?? []));
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}
