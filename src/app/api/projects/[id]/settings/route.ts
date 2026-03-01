import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

// GET /api/projects/:id/settings — get project settings (merged with global)
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Get global settings first
  const globalResult = await pool.query(
    "SELECT key, value FROM settings WHERE scope = 'global' AND scope_id IS NULL"
  );

  // Get project-specific overrides
  const projectResult = await pool.query(
    "SELECT key, value FROM settings WHERE scope = 'project' AND scope_id = $1",
    [id]
  );

  // Merge: project overrides global
  const settings: Record<string, string> = {};
  for (const row of globalResult.rows) {
    settings[row.key] = row.value;
  }
  for (const row of projectResult.rows) {
    settings[row.key] = row.value;
  }

  return NextResponse.json(settings);
}

// PUT /api/projects/:id/settings — upsert project settings
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();

  for (const [key, value] of Object.entries(body)) {
    if (value === null || value === undefined) {
      await pool.query(
        "DELETE FROM settings WHERE scope = 'project' AND scope_id = $1 AND key = $2",
        [id, key]
      );
    } else {
      const strValue = typeof value === "string" ? value : JSON.stringify(value);
      const updated = await pool.query(
        "UPDATE settings SET value = $1, updated_at = NOW() WHERE scope = 'project' AND scope_id = $2 AND key = $3 RETURNING id",
        [strValue, id, key]
      );
      if (updated.rows.length === 0) {
        await pool.query(
          "INSERT INTO settings (scope, scope_id, key, value) VALUES ('project', $1, $2, $3)",
          [id, key, strValue]
        );
      }
    }
  }

  return NextResponse.json({ ok: true });
}
