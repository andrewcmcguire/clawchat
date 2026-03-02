import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";

// POST /api/files/upload — upload file via FormData (stores locally, or S3 when configured)
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const channelId = formData.get("channel_id") as string || "general";

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  // Save file locally to uploads directory
  const uploadsDir = join(process.cwd(), "uploads", channelId);
  await mkdir(uploadsDir, { recursive: true });

  const timestamp = Date.now();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const fileName = `${timestamp}-${safeName}`;
  const filePath = join(uploadsDir, fileName);

  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(filePath, buffer);

  // Store metadata in DB
  const result = await pool.query(
    `INSERT INTO project_files (channel_id, name, file_path, file_type, file_size, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [channelId, file.name, `/uploads/${channelId}/${fileName}`, file.type || "application/octet-stream", file.size, session.user.email]
  );

  return NextResponse.json(result.rows[0]);
}
