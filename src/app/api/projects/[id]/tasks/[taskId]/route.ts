import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

// PATCH /api/projects/:id/tasks/:taskId — update a task
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; taskId: string }> }
) {
  const { id, taskId } = await params;
  const body = await req.json();

  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  for (const field of ["title", "description", "status", "priority", "assignee", "due_date", "position"] as const) {
    if (body[field] !== undefined) {
      fields.push(`${field} = $${idx++}`);
      values.push(body[field]);
    }
  }

  if (fields.length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  fields.push("updated_at = NOW()");

  const result = await pool.query(
    `UPDATE project_tasks SET ${fields.join(", ")} WHERE id = $${idx} AND channel_id = $${idx + 1} RETURNING *`,
    [...values, taskId, id]
  );

  if (result.rows.length === 0) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  return NextResponse.json(result.rows[0]);
}

// DELETE /api/projects/:id/tasks/:taskId
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; taskId: string }> }
) {
  const { id, taskId } = await params;

  const result = await pool.query(
    "DELETE FROM project_tasks WHERE id = $1 AND channel_id = $2 RETURNING id",
    [taskId, id]
  );

  if (result.rows.length === 0) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  return NextResponse.json({ deleted: true });
}
