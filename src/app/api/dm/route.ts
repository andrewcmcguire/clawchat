import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";

// GET /api/dm — list DM channels for current user
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // DM channels are stored as channels with is_dm=true and a naming convention
  const result = await pool.query(
    `SELECT c.*,
      (SELECT COUNT(*) FROM messages WHERE channel_id = c.id) as message_count,
      (SELECT content FROM messages WHERE channel_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message,
      (SELECT created_at FROM messages WHERE channel_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message_at
     FROM channels c
     WHERE c.is_dm = true
     AND (c.dm_user1 = $1 OR c.dm_user2 = $1)
     ORDER BY COALESCE((SELECT created_at FROM messages WHERE channel_id = c.id ORDER BY created_at DESC LIMIT 1), c.created_at) DESC`,
    [session.user.email]
  );

  return NextResponse.json(result.rows);
}

// POST /api/dm — create or get existing DM channel with another user
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { email } = await req.json();
  if (!email) return NextResponse.json({ error: "email is required" }, { status: 400 });
  if (email === session.user.email) return NextResponse.json({ error: "Cannot DM yourself" }, { status: 400 });

  // Check if user exists
  const userResult = await pool.query("SELECT id, email, name FROM users WHERE email = $1", [email]);
  if (userResult.rows.length === 0) return NextResponse.json({ error: "User not found" }, { status: 404 });
  const otherUser = userResult.rows[0];

  // Check for existing DM channel
  const existing = await pool.query(
    `SELECT * FROM channels WHERE is_dm = true
     AND ((dm_user1 = $1 AND dm_user2 = $2) OR (dm_user1 = $2 AND dm_user2 = $1))`,
    [session.user.email, email]
  );

  if (existing.rows.length > 0) {
    return NextResponse.json(existing.rows[0]);
  }

  // Create new DM channel
  const dmId = `dm-${Date.now()}`;
  const result = await pool.query(
    `INSERT INTO channels (id, name, workspace_id, is_dm, dm_user1, dm_user2)
     VALUES ($1, $2, 'default', true, $3, $4) RETURNING *`,
    [dmId, otherUser.name, session.user.email, email]
  );

  return NextResponse.json(result.rows[0]);
}
