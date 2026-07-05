import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startTestDb, type TestDb } from './test-db';

vi.mock('google-auth-library', () => ({
  JWT: class MockJWT {
    getAccessToken = async () => ({ token: 'fake-token' });
  },
}));

// Spec "Exactly one spreadsheet per brand": concurrent provisioning for the
// same brand must create exactly one spreadsheet and one link row.
describe('provisionBrandSheet race', () => {
  let testDb: TestDb;
  let sheets: typeof import('../google-sheets');
  const BRAND = '44444444-4444-4444-4444-444444444444';

  let createCalls = 0;

  beforeAll(async () => {
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'svc@test.iam';
    process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = 'fake-key';
    testDb = await startTestDb();
    const { migrate } = await import('../migrate');
    await migrate();
    sheets = await import('../google-sheets');

    await testDb.db.query(`INSERT INTO brands (id, name) VALUES ($1, '麥當勞')`, [BRAND]);

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const u = String(url);
        // Spreadsheet creation: POST to /spreadsheets (no id in the path).
        if (init?.method === 'POST' && /\/spreadsheets$/.test(u)) {
          createCalls++;
          // Hold the winner inside the API call so the loser is genuinely
          // waiting on the advisory lock, not finishing before the race starts.
          await new Promise((r) => setTimeout(r, 150));
          const body = JSON.parse(String(init.body)) as {
            sheets: Array<{ properties: { title: string } }>;
          };
          return new Response(
            JSON.stringify({
              spreadsheetId: `created-${createCalls}`,
              sheets: body.sheets.map((s, i) => ({
                properties: { sheetId: i, title: s.properties.title },
              })),
            }),
            { status: 200 }
          );
        }
        return new Response('{}', { status: 200 });
      })
    );
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await testDb.stop();
  });

  it('two concurrent provisions yield one spreadsheet and one link row', async () => {
    const [a, b] = await Promise.all([
      sheets.provisionBrandSheet(BRAND, '麥當勞'),
      sheets.provisionBrandSheet(BRAND, '麥當勞'),
    ]);

    expect(createCalls).toBe(1);
    expect(a.spreadsheet_id).toBe('created-1');
    expect(b.spreadsheet_id).toBe(a.spreadsheet_id);

    const links = await testDb.db.query(
      `SELECT COUNT(*)::int AS n FROM google_sheet_links WHERE brand_id = $1`,
      [BRAND]
    );
    expect((links.rows[0] as { n: number }).n).toBe(1);
  });

  it('a later provision returns the existing link without any API call', async () => {
    const before = createCalls;
    const link = await sheets.provisionBrandSheet(BRAND, '麥當勞');
    expect(link.spreadsheet_id).toBe('created-1');
    expect(createCalls).toBe(before);
  });
});
