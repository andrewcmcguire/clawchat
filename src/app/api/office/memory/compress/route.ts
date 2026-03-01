import { NextResponse } from "next/server";
import pool from "@/lib/db";

// POST /api/office/memory/compress — delete non-pinned stale entries
export async function POST() {
  try {
    const result = await pool.query(
      "DELETE FROM memory_entries WHERE workspace_id = 'default' AND pinned = false AND updated_at < NOW() - INTERVAL '24 hours' RETURNING id"
    );

    return NextResponse.json({ deleted: result.rowCount || 0 });
  } catch (err) {
    console.error("Memory compress error:", err);
    return NextResponse.json({ error: "Failed to compress" }, { status: 500 });
  }
}
