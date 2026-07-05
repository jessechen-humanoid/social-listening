import Papa from 'papaparse';
import * as XLSX from 'xlsx';

export interface ParsedFile {
  columns: string[];
  rowCount: number;
  data: Record<string, unknown>[];
  /** All sheet names in the workbook; empty for CSV files. */
  sheetNames: string[];
  /** The sheet the data was parsed from; null for CSV files. */
  selectedSheet: string | null;
}

// Multi-sheet workbooks (e.g. Qsearch comment exports with FB/YT/FORUM sheets)
// parse the first sheet by default; pass sheetName to parse a specific one.
export async function parseFile(file: File, sheetName?: string): Promise<ParsedFile> {
  const ext = file.name.split('.').pop()?.toLowerCase();

  if (ext === 'csv') {
    return parseCsv(file);
  } else if (ext === 'xlsx' || ext === 'xls') {
    return parseExcel(file, sheetName);
  }

  throw new Error('不支援的檔案格式，請上傳 CSV 或 Excel (.xlsx) 檔案');
}

function parseCsv(file: File): Promise<ParsedFile> {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete(results) {
        const data = results.data as Record<string, unknown>[];
        const columns = results.meta.fields || [];
        resolve({ columns, rowCount: data.length, data, sheetNames: [], selectedSheet: null });
      },
      error(error) {
        reject(new Error(`CSV 解析失敗：${error.message}`));
      },
    });
  });
}

async function parseExcel(file: File, sheetName?: string): Promise<ParsedFile> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const selectedSheet = sheetName ?? workbook.SheetNames[0];
  const sheet = workbook.Sheets[selectedSheet];
  if (!sheet) {
    throw new Error(`找不到工作表「${selectedSheet}」`);
  }
  const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
  const columns = data.length > 0 ? Object.keys(data[0]) : [];
  return {
    columns,
    rowCount: data.length,
    data,
    sheetNames: [...workbook.SheetNames],
    selectedSheet,
  };
}
