import { google } from "googleapis";

const SPREADSHEET_ID = "16Ojc4QSnZ5XR3AQ3QZIMKa0q6XdnGZ15tyOKk7sTbZc";
const SHEET_NAME = "冒險者公會";
// Column positions (0-indexed): email column and permission column (D = index 3)
const PERMISSION_COLUMN_INDEX = 3;

function getAuthClient() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;

  if (!email || !privateKey) {
    throw new Error("Missing Google Service Account credentials: GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY must be set");
  }

  return new google.auth.JWT({
    email,
    key: privateKey.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
}

export async function checkSheetPermission(userEmail: string): Promise<boolean> {
  const authClient = getAuthClient();
  const sheets = google.sheets({ version: "v4", auth: authClient });

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}`,
  });

  const rows = response.data.values;
  if (!rows) return false;

  for (const row of rows) {
    // Find the row where any cell contains the user's email
    const emailInRow = row.some(
      (cell: string) => typeof cell === "string" && cell.toLowerCase().trim() === userEmail.toLowerCase().trim()
    );

    if (emailInRow) {
      const permissionCell = row[PERMISSION_COLUMN_INDEX];
      // Check if D column has a checkmark (TRUE, ✓, V, v, or any truthy value)
      if (permissionCell) {
        const val = String(permissionCell).trim().toUpperCase();
        return val === "TRUE" || val === "✓" || val === "V" || val === "✔" || val === "YES";
      }
      return false;
    }
  }

  return false;
}
