import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const page = parseInt(searchParams.get("page") || "1");
  const limit = 50;
  const offset = (page - 1) * limit;
  const userFilter = searchParams.get("user");
  const actionFilter = searchParams.get("action");

  let query = "SELECT * FROM audit_log WHERE 1=1";
  const values: (string | number)[] = [];
  let paramIdx = 1;

  if (userFilter) {
    query += ` AND user_email = $${paramIdx++}`;
    values.push(userFilter);
  }
  if (actionFilter) {
    query += ` AND action = $${paramIdx++}`;
    values.push(actionFilter);
  }

  // Get total count
  const countResult = await pool.query(
    query.replace("SELECT *", "SELECT COUNT(*)"),
    values
  );
  const total = parseInt(countResult.rows[0].count);

  query += ` ORDER BY created_at DESC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`;
  values.push(limit, offset);

  const result = await pool.query(query, values);

  return NextResponse.json({
    entries: result.rows,
    total,
    page,
    totalPages: Math.ceil(total / limit),
  });
}
