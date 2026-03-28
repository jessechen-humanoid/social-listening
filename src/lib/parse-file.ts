import Papa from 'papaparse';
import * as XLSX from 'xlsx';

export interface ParsedFile {
  columns: string[];
  rowCount: number;
  data: Record<string, unknown>[];
}

export async function parseFile(file: File): Promise<ParsedFile> {
  const ext = file.name.split('.').pop()?.toLowerCase();

  if (ext === 'csv') {
    return parseCsv(file);
  } else if (ext === 'xlsx' || ext === 'xls') {
    return parseExcel(file);
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
        resolve({ columns, rowCount: data.length, data });
      },
      error(error) {
        reject(new Error(`CSV 解析失敗：${error.message}`));
      },
    });
  });
}

async function parseExcel(file: File): Promise<ParsedFile> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
  const columns = data.length > 0 ? Object.keys(data[0]) : [];
  return { columns, rowCount: data.length, data };
}
