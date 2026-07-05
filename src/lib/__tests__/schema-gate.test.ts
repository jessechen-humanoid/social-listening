import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startTestDb, type TestDb } from './test-db';

const requireSessionMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/require-session', () => ({ requireSession: requireSessionMock }));

// Spec "Task creation input validation" (zod clause) + "Unified error
// response shape" (validation names the field path).
describe('POST /api/tasks structural gate', () => {
  let testDb: TestDb;

  beforeAll(async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    requireSessionMock.mockResolvedValue({ session: { user: { email: 'a@b.c' } }, response: null });
    testDb = await startTestDb();
    const { migrate } = await import('../migrate');
    await migrate();
  });

  afterAll(async () => {
    await testDb.stop();
  });

  async function post(body: unknown) {
    const { POST } = await import('../../app/api/tasks/route');
    return POST(
      new Request('http://test/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    );
  }

  it('rejects files sent as a string with 400 VALIDATION naming the field', async () => {
    const res = await post({
      mode: 'light',
      browserUuid: 'b-1',
      config: { projectName: 'x' },
      files: 'not-an-array',
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('VALIDATION');
    expect(body.error.message).toContain('files');
  });

  it('rejects an unknown mode with 400 VALIDATION naming mode', async () => {
    const res = await post({ mode: 'batch', browserUuid: 'b-1', config: {}, files: [] });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('VALIDATION');
    expect(body.error.message).toContain('mode');
  });

  it('rejects a malformed deep-batch date with 400 naming the field path', async () => {
    const res = await post({
      mode: 'deep-batch',
      browserUuid: 'b-1',
      config: { brandId: 'brand-1', timeRangeStart: 'not-a-date', timeRangeEnd: '2026-06-30' },
      platforms: [
        {
          platform: 'ig',
          files: [{ filename: 'ig.xlsx', role: 'hotpost', data: [{ content: 'x' }] }],
        },
      ],
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('VALIDATION');
    expect(body.error.message).toContain('timeRangeStart');
  });
});
