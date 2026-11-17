import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { verifyPassword } from "@/services/userService";
import { authConfig } from "./auth.config";
import { isLoginBlocked, recordLoginAttempt } from "./rateLimit";

class RateLimitedSignin extends CredentialsSignin {
  code = "rate_limited";
}

const LoginSchema = z.object({
  email: z.email().transform((e) => e.toLowerCase()),
  password: z.string().min(1).max(128),
});

function clientIp(request: Request | undefined): string {
  const fwd = request?.headers.get("x-forwarded-for");
  return fwd?.split(",")[0]?.trim() || request?.headers.get("x-real-ip") || "unknown";
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: { email: { label: "Email" }, password: { label: "Password", type: "password" } },
      async authorize(raw, request) {
        const parsed = LoginSchema.safeParse(raw);
        if (!parsed.success) return null;
        const { email, password } = parsed.data;
        const ip = clientIp(request);

        if (await isLoginBlocked(email, ip)) throw new RateLimitedSignin();

        const user = await prisma.user.findUnique({ where: { email } });
        const ok = user?.isActive ? await verifyPassword(password, user.passwordHash) : false;
        await recordLoginAttempt(email, ip, ok);
        if (!user || !ok) {
          console.warn(`[auth] failed login for ${email} from ${ip}`);
          return null;
        }
        return { id: user.id, email: user.email, name: user.name, role: user.role, riderId: user.riderId };
      },
    }),
  ],
});
