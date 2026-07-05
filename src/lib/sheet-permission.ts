import { googleAccessToken } from "./google-auth";

const SPREADSHEET_ID = "16Ojc4QSnZ5XR3AQ3QZIMKa0q6XdnGZ15tyOKk7sTbZc";
// Column D = index 3 (0-indexed)
const PERMISSION_COLUMN_INDEX = 3;

export async function checkSheetPermission(userEmail: string): Promise<boolean> {
  // Shared cached client (readonly scope is a subset of the shared scopes).
  const accessToken = await googleAccessToken();

  // Use fetch directly to avoid googleapis URL encoding issues with Chinese sheet names
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/A:Z`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Google Sheets API error: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  const rows: string[][] = data.values || [];

  for (const row of rows) {
    const emailInRow = row.some(
      (cell) => typeof cell === "string" && cell.toLowerCase().trim() === userEmail.toLowerCase().trim()
    );

    if (emailInRow) {
      const permissionCell = row[PERMISSION_COLUMN_INDEX];
      if (permissionCell) {
        const val = String(permissionCell).trim().toUpperCase();
        return val === "TRUE" || val === "✓" || val === "V" || val === "✔" || val === "YES";
      }
      return false;
    }
  }

  return false;
}
