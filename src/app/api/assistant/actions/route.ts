import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

// GET /api/assistant/actions — list actions
export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get("status");

  try {
    let query = `SELECT aa.*, c.name as contact_name FROM assistant_actions aa
                  LEFT JOIN contacts c ON aa.target_contact_id = c.id
                  WHERE aa.workspace_id = 'default'`;
    const values: unknown[] = [];

    if (status) {
      query += " AND aa.status = $1";
      values.push(status);
    }

    query += " ORDER BY aa.created_at DESC";

    const result = await pool.query(query, values);
    return NextResponse.json(result.rows);
  } catch (err) {
    console.error("Actions GET error:", err);
    return NextResponse.json([]);
  }
}

// POST /api/assistant/actions — create action
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { action_type, title, description, target_contact_id, channel_id, payload, requires_approval = true, scheduled_for } = body;

  if (!action_type || !title) {
    return NextResponse.json({ error: "action_type and title are required" }, { status: 400 });
  }

  try {
    const result = await pool.query(
      `INSERT INTO assistant_actions (workspace_id, action_type, title, description, target_contact_id, channel_id, payload, requires_approval, scheduled_for)
       VALUES ('default', $1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [action_type, title, description || null, target_contact_id || null, channel_id || null, payload || '{}', requires_approval, scheduled_for || null]
    );

    return NextResponse.json(result.rows[0], { status: 201 });
  } catch (err) {
    console.error("Action POST error:", err);
    return NextResponse.json({ error: "Failed to create action" }, { status: 500 });
  }
}

// PATCH /api/assistant/actions — update action status
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { id, status, result } = body;

  if (!id || !status) {
    return NextResponse.json({ error: "id and status are required" }, { status: 400 });
  }

  try {
    const fields = ["status = $1"];
    const values: unknown[] = [status];
    let idx = 2;

    if (status === "completed") {
      fields.push(`completed_at = NOW()`);
    }
    if (result !== undefined) {
      fields.push(`result = $${idx++}`);
      values.push(result);
    }

    const queryResult = await pool.query(
      `UPDATE assistant_actions SET ${fields.join(", ")} WHERE id = $${idx} AND workspace_id = 'default' RETURNING *`,
      [...values, id]
    );

    if (queryResult.rows.length === 0) {
      return NextResponse.json({ error: "Action not found" }, { status: 404 });
    }

    return NextResponse.json(queryResult.rows[0]);
  } catch (err) {
    console.error("Action PATCH error:", err);
    return NextResponse.json({ error: "Failed to update action" }, { status: 500 });
  }
}
