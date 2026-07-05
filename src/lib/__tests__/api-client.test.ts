import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiFetch } from '../api-client';

// Design「前端 fetch wrapper 與錯誤呈現」.
describe('apiFetch', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const mockFetch = () => fetch as unknown as ReturnType<typeof vi.fn>;

  it('returns parsed JSON on 2xx', async () => {
    mockFetch().mockResolvedValue(new Response(JSON.stringify({ ok: 1 }), { status: 200 }));
    await expect(apiFetch<{ ok: number }>('/api/x')).resolves.toEqual({ ok: 1 });
  });

  it('throws ApiError with UNAUTHORIZED on a unified 401 body', async () => {
    mockFetch().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } }), {
        status: 401,
      })
    );
    const err = (await apiFetch('/api/x').catch((e) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe('UNAUTHORIZED');
    expect(err.status).toBe(401);
    expect(err.message).toBe('Unauthorized');
  });

  it('throws ApiError with INTERNAL fallback on a non-JSON error body', async () => {
    mockFetch().mockResolvedValue(new Response('<html>Bad Gateway</html>', { status: 502 }));
    const err = (await apiFetch('/api/x').catch((e) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe('INTERNAL');
    expect(err.message).toBe('HTTP 502');
  });
});
