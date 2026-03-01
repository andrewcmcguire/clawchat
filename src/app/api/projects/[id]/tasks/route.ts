import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

// GET /api/projects/:id/tasks — list tasks for a project
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const status = req.nextUrl.searchParams.get("status");

  let query = "SELECT * FROM project_tasks WHERE channel_id = $1";
  const values: unknown[] = [id];

  if (status) {
    query += " AND status = $2";
    values.push(status);
  }

  query += " ORDER BY position ASC, created_at ASC";

  const result = await pool.query(query, values);
  return NextResponse.json(result.rows);
}

// POST /api/projects/:id/tasks — create a task
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const { title, description, status = "backlog", priority = "medium", assignee, due_date } = body;

  if (!title) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }

  // Get next position for this status column
  const posResult = await pool.query(
    "SELECT COALESCE(MAX(position), -1) + 1 as next_pos FROM project_tasks WHERE channel_id = $1 AND status = $2",
    [id, status]
  );
  const position = posResult.rows[0].next_pos;

  const result = await pool.query(
    `INSERT INTO project_tasks (channel_id, title, description, status, priority, assignee, due_date, position)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [id, title, description || null, status, priority, assignee || null, due_date || null, position]
  );

  return NextResponse.json(result.rows[0], { status: 201 });
}
