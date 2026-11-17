import type { NextAuthConfig } from "next-auth";
import type { Role } from "@/domain/types";

/** Edge-safe part of the Auth.js config, shared by middleware and the Node route handlers. */
export const authConfig = {
  pages: { signIn: "/login" },
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 },
  trustHost: true,
  providers: [],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.uid = user.id as string;
        token.role = user.role;
        token.riderId = user.riderId ?? null;
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.uid as string;
      session.user.role = token.role as Role;
      session.user.riderId = (token.riderId as string | null) ?? null;
      return session;
    },
  },
} satisfies NextAuthConfig;
