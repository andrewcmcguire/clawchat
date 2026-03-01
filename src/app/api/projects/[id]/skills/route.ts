import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

// GET /api/projects/:id/skills — list skills for a project
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const result = await pool.query(
    "SELECT * FROM project_skills WHERE channel_id = $1 ORDER BY created_at ASC",
    [id]
  );

  return NextResponse.json(result.rows);
}

// POST /api/projects/:id/skills — add a skill
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const { name, content, file_name, file_type } = body;

  if (!name || !content) {
    return NextResponse.json(
      { error: "name and content are required" },
      { status: 400 }
    );
  }

  const result = await pool.query(
    `INSERT INTO project_skills (channel_id, name, content, file_name, file_type)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [id, name, content, file_name || null, file_type || null]
  );

  return NextResponse.json(result.rows[0], { status: 201 });
}
