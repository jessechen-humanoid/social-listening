"use client";

import { useCallback, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { parseFile } from '@/lib/parse-file';
import type { UploadedFile } from '@/lib/types';

interface FileUploadProps {
  files: UploadedFile[];
  onChange: (files: UploadedFile[]) => void;
}

export default function FileUpload({ files, onChange }: FileUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(async (fileList: FileList) => {
    const newFiles: UploadedFile[] = [];

    for (const file of Array.from(fileList)) {
      const ext = file.name.split('.').pop()?.toLowerCase();
      if (!ext || !['csv', 'xlsx', 'xls'].includes(ext)) {
        alert(`${file.name}：不支援的格式，請上傳 CSV 或 Excel (.xlsx) 檔案`);
        continue;
      }

      try {
        const parsed = await parseFile(file);
        newFiles.push({
          id: uuidv4(),
          file,
          filename: file.name,
          columns: parsed.columns,
          rowCount: parsed.rowCount,
          contentColumn: '',
          engagementColumn: '',
          data: parsed.data,
        });
      } catch (err) {
        alert(err instanceof Error ? err.message : '檔案解析失敗');
      }
    }

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

  return (
    <div className="space-y-4">
      <label className="text-sm font-medium" style={{ color: '#6b6b6b' }}>資料檔案</label>

      {/* Drop zone */}
      <div
        className="rounded-xl p-8 text-center cursor-pointer transition"
        style={{ border: '2px dashed #e8e8e5', backgroundColor: '#ffffff' }}
        onDragOver={e => e.preventDefault()}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
      >
        <p className="text-sm" style={{ color: '#6b6b6b' }}>
          拖放檔案至此，或點擊上傳
        </p>
        <p className="text-xs mt-1" style={{ color: '#c0c0c0' }}>
          支援 CSV、Excel (.xlsx)
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          multiple
          className="hidden"
          onChange={e => e.target.files && handleFiles(e.target.files)}
        />
      </div>

      {/* File list */}
      {files.map(f => (
        <div
          key={f.id}
          className="rounded-xl p-5"
          style={{ backgroundColor: '#ffffff', border: '1px solid #e8e8e5' }}
        >
          <div className="flex items-center justify-between mb-3">
            <div>
              <span className="text-sm font-medium" style={{ color: '#1a1a1a' }}>{f.filename}</span>
              <span className="text-xs ml-2" style={{ color: '#6b6b6b' }}>{f.rowCount} 列</span>
            </div>
            <button
              onClick={() => handleRemove(f.id)}
              className="text-sm px-2 py-1 rounded-lg transition"
              style={{ color: '#c75c5c' }}
            >
              移除
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Content column - required */}
            <div>
              <label className="text-xs font-medium mb-1 block" style={{ color: '#6b6b6b' }}>
                分析內容欄位 <span style={{ color: '#c75c5c' }}>*</span>
              </label>
              <select
                value={f.contentColumn}
                onChange={e => handleColumnChange(f.id, 'contentColumn', e.target.value)}
                className="w-full rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#2d2d2d] focus:outline-none"
                style={{ border: '1px solid #e8e8e5', backgroundColor: '#ffffff', color: '#1a1a1a' }}
              >
                <option value="">選擇欄位...</option>
                {f.columns.map(col => (
                  <option key={col} value={col}>{col}</option>
                ))}
              </select>
            </div>

            {/* Engagement column - optional */}
            <div>
              <label className="text-xs font-medium mb-1 block" style={{ color: '#6b6b6b' }}>
                互動量欄位（選填）
              </label>
              <select
                value={f.engagementColumn}
                onChange={e => handleColumnChange(f.id, 'engagementColumn', e.target.value)}
                className="w-full rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#2d2d2d] focus:outline-none"
                style={{ border: '1px solid #e8e8e5', backgroundColor: '#ffffff', color: '#1a1a1a' }}
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
