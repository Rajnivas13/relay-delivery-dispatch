import { redirect } from "next/navigation";
import type { SessionUser } from "@/components/session-context";
import { prisma } from "@/lib/db";
import { auth } from "./index";

/** Server-component guard: fresh user row or redirect to login. */
export async function requireUser(): Promise<SessionUser> {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user || !user.isActive) redirect("/login?error=inactive");
  return { id: user.id, name: user.name, email: user.email, role: user.role, riderId: user.riderId };
}
