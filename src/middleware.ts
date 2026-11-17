import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/auth/auth.config";

const { auth } = NextAuth(authConfig);

const ADMIN_PAGES = ["/admin"];
const RIDER_ALLOWED = ["/rider", "/forbidden", "/docs"];

export default auth((req) => {
  const { pathname, search } = req.nextUrl;

  // API routes authorise themselves (session cookie or bearer token) inside withAuth.
  if (pathname.startsWith("/api")) return NextResponse.next();

  const user = req.auth?.user;
  if (pathname === "/login") {
    if (user) return NextResponse.redirect(new URL(user.role === "RIDER" ? "/rider" : "/", req.nextUrl));
    return NextResponse.next();
  }

  if (!user) {
    const url = new URL("/login", req.nextUrl);
    url.searchParams.set("callbackUrl", pathname + search);
    return NextResponse.redirect(url);
  }

  if (user.role === "RIDER" && !RIDER_ALLOWED.some((p) => pathname.startsWith(p))) {
    return NextResponse.redirect(new URL("/rider", req.nextUrl));
  }
  if (ADMIN_PAGES.some((p) => pathname.startsWith(p)) && user.role !== "ADMIN") {
    return NextResponse.redirect(new URL("/forbidden", req.nextUrl));
  }
  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|svg|ico|jpg|webp)$).*)"],
};
