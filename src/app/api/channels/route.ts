import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { broadcast } from "@/lib/sse";

// Projects API (backed by channels table)
export async function GET() {
  const result = await pool.query(
    "SELECT id, name, description, COALESCE(project_type, 'project') as project_type, COALESCE(status, 'active') as status, created_at FROM channels ORDER BY created_at ASC"
  );

  return NextResponse.json(result.rows);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { name, description } = body;

  if (!name || typeof name !== "string") {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  // Sanitize project ID
  const projectId = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  if (!projectId) {
    return NextResponse.json({ error: "Invalid project name" }, { status: 400 });
  }

  try {
    const result = await pool.query(
      "INSERT INTO channels (id, workspace_id, name, description, project_type, status) VALUES ($1, 'default', $2, $3, 'project', 'active') RETURNING *",
      [projectId, name.trim(), description || null]
    );

    const project = result.rows[0];
    broadcast({ type: "project_created", project });

    return NextResponse.json(project, { status: 201 });
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes("duplicate key")) {
      return NextResponse.json({ error: "Project already exists" }, { status: 409 });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// PATCH — rename/update project
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { id, name, description } = body;

  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (name !== undefined) { fields.push(`name = $${idx++}`); values.push(name); }
  if (description !== undefined) { fields.push(`description = $${idx++}`); values.push(description); }

  if (fields.length === 0) return NextResponse.json({ error: "No fields to update" }, { status: 400 });

  values.push(id);
  try {
    const result = await pool.query(`UPDATE channels SET ${fields.join(", ")} WHERE id = $${idx} RETURNING *`, values);
    if (result.rows.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(result.rows[0]);
  } catch (err) {
    console.error("Channel PATCH error:", err);
    return NextResponse.json({ error: "Failed to update" }, { status: 500 });
  }
}

// DELETE — delete project
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  if (id === "general") return NextResponse.json({ error: "Cannot delete General project" }, { status: 400 });

  try {
    await pool.query("DELETE FROM channels WHERE id = $1", [id]);
    return NextResponse.json({ deleted: true });
  } catch (err) {
    console.error("Channel DELETE error:", err);
    return NextResponse.json({ error: "Failed to delete" }, { status: 500 });
  }
}
