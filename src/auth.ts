import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import pool from "@/lib/db";

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        try {
          const email = credentials?.email as string | undefined;
          const password = credentials?.password as string | undefined;
          if (!email || !password) return null;

          const result = await pool.query(
            "SELECT id, email, name, password_hash, avatar_url, is_admin FROM users WHERE email = $1",
            [email]
          );

          const user = result.rows[0];
          if (!user || !user.password_hash) return null;

          const valid = await bcrypt.compare(password, user.password_hash);
          if (!valid) return null;

          // Update last login
          await pool.query(
            "UPDATE users SET last_login_at = NOW() WHERE id = $1",
            [user.id]
          );

          // Audit log
          await pool.query(
            "INSERT INTO audit_log (user_email, action, resource_type) VALUES ($1, $2, $3)",
            [user.email, "login", "session"]
          );

          return {
            id: String(user.id),
            email: user.email,
            name: user.name,
            image: user.avatar_url,
            isAdmin: user.is_admin,
          };
        } catch (error) {
          console.error("[auth] authorize error:", error);
          return null;
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        try {
          token.userId = user.id;
          token.isAdmin = (user as any).isAdmin;

          const result = await pool.query(
            "SELECT workspace_id, role FROM workspace_members WHERE email = $1 AND status = 'active' LIMIT 1",
            [user.email]
          );
          if (result.rows[0]) {
            token.workspaceId = result.rows[0].workspace_id;
            token.role = result.rows[0].role;
          } else {
            token.workspaceId = "default";
            token.role = (user as any).isAdmin ? "admin" : "member";
          }
        } catch {
          token.workspaceId = "default";
          token.role = "member";
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.userId as string;
        session.user.role = token.role as string;
        session.user.workspaceId = token.workspaceId as string;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
});
