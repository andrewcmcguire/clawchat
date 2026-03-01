import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

// GET /api/workspaces — list workspaces with member count
export async function GET() {
  try {
    const result = await pool.query(
      `SELECT w.*, COUNT(wm.id)::int as member_count
       FROM workspaces w
       LEFT JOIN workspace_members wm ON w.id = wm.workspace_id AND wm.status = 'active'
       GROUP BY w.id
       ORDER BY w.created_at ASC`
    );

    return NextResponse.json(result.rows);
  } catch (err) {
    console.error("Workspaces GET error:", err);
    return NextResponse.json([{ id: "default", name: "SteadyChat", member_count: 1 }]);
  }
}

// POST /api/workspaces — create workspace
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { name, description } = body;

  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  try {
    const result = await pool.query(
      `INSERT INTO workspaces (id, name, description) VALUES ($1, $2, $3) RETURNING *`,
      [id, name, description || null]
    );

    return NextResponse.json(result.rows[0], { status: 201 });
  } catch (err) {
    console.error("Workspace POST error:", err);
    return NextResponse.json({ error: "Failed to create workspace" }, { status: 500 });
  }
}

// PATCH /api/workspaces — update workspace
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { id, name, description, settings } = body;

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (name !== undefined) {
    fields.push(`name = $${idx++}`);
    values.push(name);
  }
  if (description !== undefined) {
    fields.push(`description = $${idx++}`);
    values.push(description);
  }
  if (settings !== undefined) {
    fields.push(`settings = $${idx++}`);
    values.push(JSON.stringify(settings));
  }

  if (fields.length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  try {
    const result = await pool.query(
      `UPDATE workspaces SET ${fields.join(", ")} WHERE id = $${idx} RETURNING *`,
      [...values, id]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    return NextResponse.json(result.rows[0]);
  } catch (err) {
    console.error("Workspace PATCH error:", err);
    return NextResponse.json({ error: "Failed to update workspace" }, { status: 500 });
  }
}
