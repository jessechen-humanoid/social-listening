import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { checkSheetPermission } from "./sheet-permission";

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      authorization: {
        params: {
          // Request Sheets + Drive.file scopes for deep-mode brand spreadsheets.
          scope:
            'openid email profile ' +
            'https://www.googleapis.com/auth/spreadsheets ' +
            'https://www.googleapis.com/auth/drive.file',
          access_type: 'offline',
          prompt: 'consent',
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
    async signIn({ user }) {
      if (!user.email) return false;

      try {
        const hasPermission = await checkSheetPermission(user.email);
        if (!hasPermission) {
          return "/auth/unauthorized";
        }
        return true;
      } catch (error) {
        console.error("Permission check failed:", error);
        return "/auth/error?error=VerificationFailed";
      }
    },
  },
});
