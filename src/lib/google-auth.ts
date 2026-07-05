import { JWT } from 'google-auth-library';

// Single shared service-account client (spec "Exactly one spreadsheet per
// brand", token-reuse clause): google-auth-library caches the access token on
// the client and refreshes it near expiry — reusing one instance means one
// token exchange instead of one per API call. Scopes are the union of every
// caller's needs (sheets sync + permission checks read the same scopes).
let client: JWT | null = null;

export function googleAuthClient(): JWT {
  if (client) return client;
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  if (!email || !privateKey) {
    throw new Error('Missing Google service account credentials');
  }
  client = new JWT({
    email,
    key: privateKey.replace(/\\n/g, '\n'),
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive.file',
    ],
  });
  return client;
}

// Cached bearer token via the shared client.
export async function googleAccessToken(): Promise<string> {
  const { token } = await googleAuthClient().getAccessToken();
  if (!token) throw new Error('Failed to obtain Google access token');
  return token;
}
