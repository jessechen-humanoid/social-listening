import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { checkSheetPermission } from "./sheet-permission";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
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
