import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

// GET /api/calls — list call transcripts
export async function GET(req: NextRequest) {
  const contact_id = req.nextUrl.searchParams.get("contact_id");

  try {
    let query = "SELECT * FROM call_transcripts WHERE workspace_id = 'default'";
    const values: unknown[] = [];

    if (contact_id) {
      query += " AND contact_id = $1";
      values.push(contact_id);
    }

    query += " ORDER BY created_at DESC";

    const result = await pool.query(query, values);
    return NextResponse.json(result.rows);
  } catch (err) {
    console.error("Calls GET error:", err);
    return NextResponse.json([]);
  }
}

// POST /api/calls — create call transcript
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { contact_id, channel_id, title, duration_seconds, transcript, call_type = "outbound" } = body;

  if (!title) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }

  try {
    const result = await pool.query(
      `INSERT INTO call_transcripts (workspace_id, contact_id, channel_id, title, duration_seconds, transcript, call_type)
       VALUES ('default', $1, $2, $3, $4, $5, $6) RETURNING *`,
      [contact_id || null, channel_id || null, title, duration_seconds || null, transcript || null, call_type]
    );

    return NextResponse.json(result.rows[0], { status: 201 });
  } catch (err) {
    console.error("Call POST error:", err);
    return NextResponse.json({ error: "Failed to create call" }, { status: 500 });
  }
}
