import type { DefaultSession } from "next-auth";
import type { Role } from "@/domain/types";

declare module "next-auth" {
  interface User {
    role: Role;
    riderId?: string | null;
  }
  interface Session {
    user: {
      id: string;
      role: Role;
      riderId: string | null;
    } & DefaultSession["user"];
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    uid?: string;
    role?: Role;
    riderId?: string | null;
  }
}
