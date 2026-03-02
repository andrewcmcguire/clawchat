import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { requireAuth } from "@/lib/auth-helpers";

export async function GET(req: Request) {
  try {
    await requireAuth();
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");
    const priority = searchParams.get("priority");
    const project = searchParams.get("project");

    let query = `
      SELECT pt.*, c.name AS project_name
      FROM project_tasks pt
      LEFT JOIN channels c ON pt.channel_id = c.id
      WHERE pt.status != 'done'
    `;
    const params: any[] = [];
    let idx = 1;

    if (status) {
      query += ` AND pt.status = $${idx++}`;
      params.push(status);
    }
    if (priority) {
      query += ` AND pt.priority = $${idx++}`;
      params.push(priority);
    }
    if (project) {
      query += ` AND c.name = $${idx++}`;
      params.push(project);
    }

    query += ` ORDER BY
      CASE pt.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 END,
      pt.due_date ASC NULLS LAST,
      pt.created_at DESC
    `;

    const result = await pool.query(query, params);
    return NextResponse.json(result.rows);
  } catch (e: any) {
    if (e.message === "Unauthorized") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
