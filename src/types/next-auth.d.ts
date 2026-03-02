import "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name: string;
      email: string;
      image?: string | null;
      role: string;
      workspaceId: string;
    };
  }

  interface User {
    isAdmin?: boolean;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId?: string;
    role?: string;
    workspaceId?: string;
    isAdmin?: boolean;
  }
}
