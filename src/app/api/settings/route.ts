import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

// GET /api/settings — get all global settings
export async function GET() {
  const result = await pool.query(
    "SELECT key, value FROM settings WHERE scope = 'global' AND scope_id IS NULL ORDER BY key"
  );

  const settings: Record<string, string> = {};
  for (const row of result.rows) {
    settings[row.key] = row.value;
  }

  return NextResponse.json(settings);
}

// PUT /api/settings — upsert global settings
export async function PUT(req: NextRequest) {
  const body = await req.json();

  for (const [key, value] of Object.entries(body)) {
    if (value === null || value === undefined) {
      await pool.query(
        "DELETE FROM settings WHERE scope = 'global' AND scope_id IS NULL AND key = $1",
        [key]
      );
    } else {
      const strValue = typeof value === "string" ? value : JSON.stringify(value);
      // Try update first, then insert
      const updated = await pool.query(
        "UPDATE settings SET value = $1, updated_at = NOW() WHERE scope = 'global' AND scope_id IS NULL AND key = $2 RETURNING id",
        [strValue, key]
      );
      if (updated.rows.length === 0) {
        await pool.query(
          "INSERT INTO settings (scope, scope_id, key, value) VALUES ('global', NULL, $1, $2)",
          [key, strValue]
        );
      }
    }
  }

  return NextResponse.json({ ok: true });
}
