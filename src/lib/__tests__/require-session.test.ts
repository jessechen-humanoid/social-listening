import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMock = vi.hoisted(() => vi.fn());
vi.mock('../auth', () => ({ auth: authMock }));

import { requireSession } from '../require-session';

describe('requireSession', () => {
  beforeEach(() => {
    authMock.mockReset();
  });

  it('returns a 401 JSON response of shape { error: "Unauthorized" } without a session', async () => {
    authMock.mockResolvedValue(null);
    const { session, response } = await requireSession();
    expect(session).toBeNull();
    expect(response).not.toBeNull();
    expect(response!.status).toBe(401);
    expect(await response!.json()).toEqual({ error: 'Unauthorized' });
  });

  it('returns a 401 when the session has no user', async () => {
    authMock.mockResolvedValue({});
    const { response } = await requireSession();
    expect(response?.status).toBe(401);
  });

  it('returns the session object when authenticated', async () => {
    const fakeSession = { user: { email: 'member@humanoid.com.tw' } };
    authMock.mockResolvedValue(fakeSession);
    const { session, response } = await requireSession();
    expect(response).toBeNull();
    expect(session).toBe(fakeSession);
  });
});
