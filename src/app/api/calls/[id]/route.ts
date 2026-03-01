import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

// GET /api/calls/:id — full transcript detail
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const result = await pool.query(
      "SELECT * FROM call_transcripts WHERE id = $1 AND workspace_id = 'default'",
      [id]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "Call not found" }, { status: 404 });
    }

    return NextResponse.json(result.rows[0]);
  } catch (err) {
    console.error("Call detail GET error:", err);
    return NextResponse.json({ error: "Failed to load call" }, { status: 500 });
  }
}
