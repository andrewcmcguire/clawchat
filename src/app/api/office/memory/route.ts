import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

// GET /api/office/memory — list memory entries + health stats
export async function GET(req: NextRequest) {
  const scope = req.nextUrl.searchParams.get("scope");

  try {
    let query = "SELECT * FROM memory_entries WHERE workspace_id = 'default'";
    const values: unknown[] = [];

    if (scope && scope !== "all") {
      query += " AND scope = $1";
      values.push(scope);
    }

    query += " ORDER BY updated_at DESC";

    const entriesResult = await pool.query(query, values);

    // Health stats
    const healthResult = await pool.query(`
      SELECT
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE pinned = true)::int as pinned,
        CASE WHEN COUNT(*) > 0
          THEN ROUND(COUNT(*) FILTER (WHERE updated_at < NOW() - INTERVAL '24 hours')::numeric / COUNT(*)::numeric * 100, 1)
          ELSE 0
        END as stale_percent
      FROM memory_entries WHERE workspace_id = 'default'
    `);

    const health = healthResult.rows[0];

    // Recent writes (last 10)
    const recentResult = await pool.query(
      "SELECT * FROM memory_entries WHERE workspace_id = 'default' ORDER BY updated_at DESC LIMIT 10"
    );

    return NextResponse.json({
      entries: entriesResult.rows,
      health: {
        total: health.total,
        pinned: health.pinned,
        stalePercent: parseFloat(health.stale_percent) || 0,
        compressionRatio: 1,
      },
      recentWrites: recentResult.rows,
    });
  } catch (err) {
    console.error("Memory GET error:", err);
    return NextResponse.json({ entries: [], health: { total: 0, pinned: 0, stalePercent: 0, compressionRatio: 1 }, recentWrites: [] });
  }
}

// POST /api/office/memory — upsert memory entry
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { scope, scope_id = "default", key, value, pinned } = body;

  if (!scope || !key || !value) {
    return NextResponse.json({ error: "scope, key, and value are required" }, { status: 400 });
  }

  try {
    const result = await pool.query(
      `INSERT INTO memory_entries (workspace_id, scope, scope_id, key, value, pinned)
       VALUES ('default', $1, $2, $3, $4, $5)
       ON CONFLICT (workspace_id, scope, scope_id, key) DO UPDATE SET
         value = EXCLUDED.value,
         pinned = COALESCE(EXCLUDED.pinned, memory_entries.pinned),
         version = memory_entries.version + 1,
         updated_at = NOW()
       RETURNING *`,
      [scope, scope_id, key, value, pinned ?? false]
    );

    return NextResponse.json(result.rows[0], { status: 201 });
  } catch (err) {
    console.error("Memory POST error:", err);
    return NextResponse.json({ error: "Failed to upsert memory" }, { status: 500 });
  }
}

// DELETE /api/office/memory — delete by scope/scope_id/key
export async function DELETE(req: NextRequest) {
  const scope = req.nextUrl.searchParams.get("scope");
  const scope_id = req.nextUrl.searchParams.get("scope_id");
  const key = req.nextUrl.searchParams.get("key");

  if (!scope || !scope_id || !key) {
    return NextResponse.json({ error: "scope, scope_id, and key are required" }, { status: 400 });
  }

  try {
    const result = await pool.query(
      "DELETE FROM memory_entries WHERE workspace_id = 'default' AND scope = $1 AND scope_id = $2 AND key = $3 RETURNING id",
      [scope, scope_id, key]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "Memory entry not found" }, { status: 404 });
    }

    return NextResponse.json({ deleted: true });
  } catch (err) {
    console.error("Memory DELETE error:", err);
    return NextResponse.json({ error: "Failed to delete" }, { status: 500 });
  }
}
