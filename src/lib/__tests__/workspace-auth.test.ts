import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JWT } from 'next-auth/jwt';
import {
  ALLOWED_WORKSPACE_DOMAIN,
  REAUTH_WINDOW_MS,
  enforceReauthWindow,
  verifyWorkspaceProfile,
} from '../workspace-auth';

// Spec "Workspace domain-restricted sign-in".
describe('verifyWorkspaceProfile', () => {
  it('authorizes a verified company Workspace account', () => {
    expect(
      verifyWorkspaceProfile({ email_verified: true, hd: ALLOWED_WORKSPACE_DOMAIN })
    ).toBe(true);
  });

  it('rejects a personal Gmail account (no hd claim)', () => {
    expect(verifyWorkspaceProfile({ email_verified: true })).toBe(false);
    expect(verifyWorkspaceProfile({ email_verified: true, hd: null })).toBe(false);
  });

  it('rejects a foreign Workspace domain', () => {
    expect(verifyWorkspaceProfile({ email_verified: true, hd: 'evil-corp.com' })).toBe(false);
  });

  it('rejects an unverified email even on the right domain', () => {
    expect(
      verifyWorkspaceProfile({ email_verified: false, hd: ALLOWED_WORKSPACE_DOMAIN })
    ).toBe(false);
    expect(
      verifyWorkspaceProfile({ email_verified: null, hd: ALLOWED_WORKSPACE_DOMAIN })
    ).toBe(false);
  });

  it('rejects a missing profile', () => {
    expect(verifyWorkspaceProfile(undefined)).toBe(false);
  });
});

// Spec "Periodic re-authentication window".
describe('enforceReauthWindow', () => {
  const NOW = 1_800_000_000_000;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sign-in stamps authenticatedAt', () => {
    const out = enforceReauthWindow({} as JWT, 'signIn');
    expect(out?.authenticatedAt).toBe(NOW);
  });

  it('within 7 days the token passes through unchanged', () => {
    const token = { authenticatedAt: NOW - (REAUTH_WINDOW_MS - 1) } as JWT;
    expect(enforceReauthWindow(token)).toBe(token);
  });

  it('past 7 days the token is invalidated (forces silent re-SSO)', () => {
    const token = { authenticatedAt: NOW - (REAUTH_WINDOW_MS + 1) } as JWT;
    expect(enforceReauthWindow(token)).toBeNull();
  });

  it('a pre-deploy token without authenticatedAt counts as past the window', () => {
    expect(enforceReauthWindow({} as JWT)).toBeNull();
  });
});
