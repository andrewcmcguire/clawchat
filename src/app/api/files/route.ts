import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";

// GET /api/files?channel_id=xxx — list files for a project (or all)
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const channelId = searchParams.get("channel_id");

  let query: string;
  let values: string[];

  if (channelId) {
    query = `SELECT pf.*, c.name as project_name FROM project_files pf
             LEFT JOIN channels c ON c.id = pf.channel_id
             WHERE pf.channel_id = $1 ORDER BY pf.created_at DESC`;
    values = [channelId];
  } else {
    query = `SELECT pf.*, c.name as project_name FROM project_files pf
             LEFT JOIN channels c ON c.id = pf.channel_id
             ORDER BY pf.created_at DESC`;
    values = [];
  }

  const result = await pool.query(query, values);
  return NextResponse.json(result.rows);
}

// POST /api/files — upload file metadata (S3 upload happens client-side via presigned URL)
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { channel_id, name, file_path, file_type, file_size, s3_key } = body;

  if (!channel_id || !name || !file_type) {
    return NextResponse.json({ error: "channel_id, name, and file_type are required" }, { status: 400 });
  }

  const result = await pool.query(
    `INSERT INTO project_files (channel_id, name, file_path, file_type, file_size, s3_key, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [channel_id, name, file_path || "", file_type, file_size || 0, s3_key || null, session.user.email]
  );

  return NextResponse.json(result.rows[0]);
}

// DELETE /api/files?id=xxx
export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  await pool.query("DELETE FROM project_files WHERE id = $1", [id]);
  return NextResponse.json({ success: true });
}
