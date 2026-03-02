import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import bcrypt from "bcryptjs";

// POST /api/account/password — change own password
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { currentPassword, newPassword } = await req.json();

  if (!currentPassword || !newPassword) {
    return NextResponse.json({ error: "Both currentPassword and newPassword are required" }, { status: 400 });
  }

  if (newPassword.length < 8) {
    return NextResponse.json({ error: "New password must be at least 8 characters" }, { status: 400 });
  }

  // Verify current password
  const result = await pool.query("SELECT password_hash FROM users WHERE email = $1", [session.user.email]);
  const user = result.rows[0];
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const valid = await bcrypt.compare(currentPassword, user.password_hash);
  if (!valid) return NextResponse.json({ error: "Current password is incorrect" }, { status: 403 });

  // Hash and update
  const newHash = await bcrypt.hash(newPassword, 12);
  await pool.query("UPDATE users SET password_hash = $1, updated_at = NOW() WHERE email = $2", [newHash, session.user.email]);

  // Audit log
  await pool.query(
    "INSERT INTO audit_log (user_email, action, resource_type) VALUES ($1, $2, $3)",
    [session.user.email, "password_change", "user"]
  );

  return NextResponse.json({ success: true });
}
