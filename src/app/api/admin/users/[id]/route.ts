import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { logAudit } from "@/lib/auth-helpers";

async function requireAdmin() {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") return null;
  return session;
}

// PATCH /api/admin/users/[id] — update user role or deactivate
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const body = await req.json();
  const { role, status, name } = body;

  // Get user email for workspace_members update
  const userResult = await pool.query("SELECT email FROM users WHERE id = $1", [id]);
  if (userResult.rows.length === 0) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  const email = userResult.rows[0].email;

  if (role) {
    await pool.query("UPDATE users SET is_admin = $1, updated_at = NOW() WHERE id = $2", [role === "admin", id]);
    await pool.query("UPDATE workspace_members SET role = $1 WHERE email = $2 AND workspace_id = 'default'", [role, email]);
  }

  if (status) {
    await pool.query("UPDATE workspace_members SET status = $1 WHERE email = $2 AND workspace_id = 'default'", [status, email]);
  }

  if (name) {
    await pool.query("UPDATE users SET name = $1, updated_at = NOW() WHERE id = $2", [name, id]);
    await pool.query("UPDATE workspace_members SET name = $1 WHERE email = $2 AND workspace_id = 'default'", [name, email]);
  }

  await logAudit(session.user.email, "update_user", "user", email, { role, status, name });

  return NextResponse.json({ success: true });
}

// DELETE /api/admin/users/[id]
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;

  const userResult = await pool.query("SELECT email FROM users WHERE id = $1", [id]);
  if (userResult.rows.length === 0) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  const email = userResult.rows[0].email;

  // Don't allow deleting yourself
  if (email === session.user.email) {
    return NextResponse.json({ error: "Cannot delete your own account" }, { status: 400 });
  }

  await pool.query("DELETE FROM workspace_members WHERE email = $1", [email]);
  await pool.query("DELETE FROM users WHERE id = $1", [id]);

  await logAudit(session.user.email, "delete_user", "user", email);

  return NextResponse.json({ success: true });
}
