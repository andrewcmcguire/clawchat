import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import bcrypt from "bcryptjs";
import { logAudit } from "@/lib/auth-helpers";
import crypto from "crypto";

async function requireAdmin() {
  const session = await auth();
  if (!session?.user) return null;
  if (session.user.role !== "admin") return null;
  return session;
}

// GET /api/admin/users — list all users
export async function GET() {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const result = await pool.query(
    `SELECT u.id, u.email, u.name, u.avatar_url, u.auth_provider, u.is_admin, u.last_login_at, u.created_at,
            wm.role, wm.status, wm.workspace_id
     FROM users u
     LEFT JOIN workspace_members wm ON wm.email = u.email AND wm.workspace_id = 'default'
     ORDER BY u.created_at ASC`
  );

  return NextResponse.json(result.rows);
}

// POST /api/admin/users — invite a new user
export async function POST(req: NextRequest) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const { name, email, role = "member" } = body;

  if (!name || !email) {
    return NextResponse.json({ error: "name and email are required" }, { status: 400 });
  }

  // Check if user already exists
  const existing = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
  if (existing.rows.length > 0) {
    return NextResponse.json({ error: "User with this email already exists" }, { status: 409 });
  }

  // Generate temporary password
  const tempPassword = crypto.randomBytes(6).toString("base64url").slice(0, 12);
  const hash = await bcrypt.hash(tempPassword, 12);

  // Create user
  const userResult = await pool.query(
    `INSERT INTO users (email, name, password_hash, is_admin, auth_provider)
     VALUES ($1, $2, $3, $4, 'credentials') RETURNING id, email, name, created_at`,
    [email, name, hash, role === "admin"]
  );

  // Add to workspace
  await pool.query(
    `INSERT INTO workspace_members (workspace_id, email, name, role, status, joined_at)
     VALUES ('default', $1, $2, $3, 'active', NOW())
     ON CONFLICT (workspace_id, email) DO UPDATE SET role = $3, status = 'active'`,
    [email, name, role]
  );

  await logAudit(session.user.email, "invite_user", "user", email, { role });

  return NextResponse.json({
    user: userResult.rows[0],
    temporaryPassword: tempPassword,
  });
}
