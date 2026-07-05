import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import {
  ALLOWED_WORKSPACE_DOMAIN,
  enforceReauthWindow,
  verifyWorkspaceProfile,
} from "./workspace-auth";

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      authorization: {
        params: {
          // Minimal OIDC scopes (spec "Minimal OAuth scopes"): all Sheets
          // access goes through the service account, never the user's token.
          scope: 'openid email profile',
          // Account-picker pre-filter only — enforcement is the hd claim
          // check in the signIn callback (spec "Workspace domain-restricted
          // sign-in").
          hd: ALLOWED_WORKSPACE_DOMAIN,
        },
      },
    }),
  ],
  session: {
    strategy: "jwt",
  },
  pages: {
    signIn: "/auth/signin",
    error: "/auth/error",
  },
  callbacks: {
    // Workspace domain gate (spec "Workspace domain-restricted sign-in"):
    // pure claim check on the signed ID token — no whitelist, no API call.
    async signIn({ profile }) {
      if (!verifyWorkspaceProfile(profile)) return "/auth/unauthorized";
      return true;
    },
    // Absolute re-auth window (spec "Periodic re-authentication window").
    async jwt({ token, trigger }) {
      return enforceReauthWindow(token, trigger);
    },
  },
});
