import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: DefaultSession["user"] & { id: string; discordUserId: string | null };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId?: number;
    discordId?: string;
  }
}

export {};
