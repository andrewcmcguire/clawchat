import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { broadcast } from "@/lib/sse";

export async function GET(req: NextRequest) {
  const channelId = req.nextUrl.searchParams.get("channel_id") || "general";

  const result = await pool.query(
    "SELECT * FROM approvals WHERE channel_id = $1 ORDER BY created_at DESC LIMIT 50",
    [channelId]
  );

  return NextResponse.json(result.rows);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { message_id, channel_id, title, description, requested_by } = body;

  if (!title || !channel_id || !requested_by) {
    return NextResponse.json(
      { error: "title, channel_id, and requested_by are required" },
      { status: 400 }
    );
  }

  const result = await pool.query(
    `INSERT INTO approvals (message_id, channel_id, title, description, requested_by)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [message_id || null, channel_id, title, description || null, requested_by]
  );

  const approval = result.rows[0];
  broadcast({ type: "approval", approval });

  return NextResponse.json(approval);
}

export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { id, status, resolved_by = "You" } = body;

  if (!id || !["approved", "rejected"].includes(status)) {
    return NextResponse.json(
      { error: "id and valid status (approved/rejected) required" },
      { status: 400 }
    );
  }

  const result = await pool.query(
    `UPDATE approvals SET status = $1, resolved_by = $2, resolved_at = NOW()
     WHERE id = $3 RETURNING *`,
    [status, resolved_by, id]
  );

  if (result.rows.length === 0) {
    return NextResponse.json({ error: "Approval not found" }, { status: 404 });
  }

  const approval = result.rows[0];
  broadcast({ type: "approval_update", approval });

  return NextResponse.json(approval);
}
