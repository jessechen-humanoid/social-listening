import type { JWT } from "next-auth/jwt";

// Workspace domain gate (spec "Workspace domain-restricted sign-in"): the
// company domain is not a secret, so a code default avoids the
// missing-env-locks-everyone-out deployment trap; the env override is the
// escape hatch for a domain change.
export const ALLOWED_WORKSPACE_DOMAIN =
  process.env.ALLOWED_WORKSPACE_DOMAIN || "humanoid.com.tw";

// Absolute re-auth window (spec "Periodic re-authentication window"): active
// Workspace accounts pass the forced re-SSO silently; suspended ones cannot,
// so a departed employee loses access within this window. 7 days per Jesse.
export const REAUTH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

// Trust boundary: `hd` is Google's hosted-domain claim inside the SIGNED ID
// token — personal Gmail has none, foreign Workspaces carry their own domain.
// This check, not the `hd` authorization param (UX-only), is the enforcement.
export function verifyWorkspaceProfile(
  profile: { email_verified?: boolean | null; hd?: string | null } | undefined
): boolean {
  return profile?.email_verified === true && profile?.hd === ALLOWED_WORKSPACE_DOMAIN;
}

// Returning null from the jwt callback is Auth.js v5's session invalidation:
// the next navigation re-runs Google sign-in. A token without authenticatedAt
// (pre-deploy session) counts as past the window — one silent migration SSO.
export function enforceReauthWindow(
  token: JWT,
  trigger?: "signIn" | "signUp" | "update"
): JWT | null {
  if (trigger === "signIn" || trigger === "signUp") {
    token.authenticatedAt = Date.now();
    return token;
  }
  const authenticatedAt =
    typeof token.authenticatedAt === "number" ? token.authenticatedAt : 0;
  if (Date.now() - authenticatedAt > REAUTH_WINDOW_MS) return null;
  return token;
}
