"use server";

import { AuthError, CredentialsSignin } from "next-auth";
import { redirect } from "next/navigation";
import { signIn, signOut } from "@/auth";
import { prisma } from "@/lib/db";

export interface LoginState {
  error?: string;
}

function safeCallback(url: FormDataEntryValue | null): string {
  const value = typeof url === "string" ? url : "/";
  return value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  try {
    await signIn("credentials", {
      email,
      password: formData.get("password"),
      redirect: false,
    });
  } catch (err) {
    if (err instanceof CredentialsSignin && err.code === "rate_limited") {
      return { error: "Too many failed attempts. Try again in 15 minutes." };
    }
    if (err instanceof AuthError) return { error: "Invalid email or password." };
    throw err;
  }

  const user = await prisma.user.findUnique({ where: { email }, select: { role: true } });
  const callback = safeCallback(formData.get("callbackUrl"));
  if (user?.role === "RIDER") redirect(callback.startsWith("/rider") ? callback : "/rider");
  redirect(callback);
}

export async function logout() {
  await signOut({ redirectTo: "/login" });
}
