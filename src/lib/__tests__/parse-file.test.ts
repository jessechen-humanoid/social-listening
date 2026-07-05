import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { parseFile } from '../parse-file';

// Spec "Multi-sheet workbook selection" — parsing layer.
function makeWorkbookFile(sheets: Record<string, Record<string, unknown>[]>): File {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), name);
  }
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return new File([buf], 'test.xlsx');
}

const MULTI = {
  FB: [
    { message: 'fb comment 1', like_count: 3 },
    { message: 'fb comment 2', like_count: 5 },
  ],
  YT: [{ message: 'yt comment', like_count: 1 }],
  FORUM: [
    { message: 'forum comment 1', like_count: 0 },
    { message: 'forum comment 2', like_count: 2 },
    { message: 'forum comment 3', like_count: 7 },
  ],
};

describe('parseFile multi-sheet workbooks', () => {
  it('lists all sheet names and defaults to the first sheet', async () => {
    const parsed = await parseFile(makeWorkbookFile(MULTI));
    expect(parsed.sheetNames).toEqual(['FB', 'YT', 'FORUM']);
    expect(parsed.selectedSheet).toBe('FB');
    expect(parsed.rowCount).toBe(2);
    expect(parsed.columns).toEqual(['message', 'like_count']);
  });

  it('parses a specified sheet', async () => {
    const parsed = await parseFile(makeWorkbookFile(MULTI), 'FORUM');
    expect(parsed.selectedSheet).toBe('FORUM');
    expect(parsed.rowCount).toBe(3);
    expect(parsed.data[0]).toMatchObject({ message: 'forum comment 1' });
  });

  it('throws a named error for a missing sheet', async () => {
    await expect(parseFile(makeWorkbookFile(MULTI), 'NOPE')).rejects.toThrow('NOPE');
  });

  it('keeps single-sheet behavior unchanged', async () => {
    const parsed = await parseFile(makeWorkbookFile({ Sheet1: MULTI.FB }));
    expect(parsed.sheetNames).toEqual(['Sheet1']);
    expect(parsed.rowCount).toBe(2);
  });
});
