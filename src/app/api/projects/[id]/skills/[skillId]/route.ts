import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

// PATCH /api/projects/:id/skills/:skillId — update skill content or toggle active
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; skillId: string }> }
) {
  const { id, skillId } = await params;
  const body = await req.json();

  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (body.name !== undefined) {
    fields.push(`name = $${idx++}`);
    values.push(body.name);
  }
  if (body.content !== undefined) {
    fields.push(`content = $${idx++}`);
    values.push(body.content);
  }
  if (body.active !== undefined) {
    fields.push(`active = $${idx++}`);
    values.push(body.active);
  }

  if (fields.length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  fields.push(`updated_at = NOW()`);

  const result = await pool.query(
    `UPDATE project_skills SET ${fields.join(", ")} WHERE id = $${idx} AND channel_id = $${idx + 1} RETURNING *`,
    [...values, skillId, id]
  );

  if (result.rows.length === 0) {
    return NextResponse.json({ error: "Skill not found" }, { status: 404 });
  }

  return NextResponse.json(result.rows[0]);
}

// DELETE /api/projects/:id/skills/:skillId
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; skillId: string }> }
) {
  const { id, skillId } = await params;

  const result = await pool.query(
    "DELETE FROM project_skills WHERE id = $1 AND channel_id = $2 RETURNING id",
    [skillId, id]
  );

  if (result.rows.length === 0) {
    return NextResponse.json({ error: "Skill not found" }, { status: 404 });
  }

  return NextResponse.json({ deleted: true });
}
