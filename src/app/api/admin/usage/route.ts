import { NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";

export async function GET() {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // 24h totals by type
  const totals24h = await pool.query(
    `SELECT usage_type, COALESCE(SUM(amount), 0) as total
     FROM usage_log WHERE created_at > NOW() - INTERVAL '24 hours'
     GROUP BY usage_type`
  );

  // Last 7 days by day
  const daily = await pool.query(
    `SELECT DATE(created_at) as day, usage_type, COALESCE(SUM(amount), 0) as total
     FROM usage_log WHERE created_at > NOW() - INTERVAL '7 days'
     GROUP BY DATE(created_at), usage_type
     ORDER BY day`
  );

  // By user (top 10)
  const byUser = await pool.query(
    `SELECT user_email, usage_type, COALESCE(SUM(amount), 0) as total
     FROM usage_log WHERE created_at > NOW() - INTERVAL '7 days' AND user_email IS NOT NULL
     GROUP BY user_email, usage_type
     ORDER BY total DESC LIMIT 20`
  );

  // By model
  const byModel = await pool.query(
    `SELECT model, COALESCE(SUM(amount), 0) as total
     FROM usage_log WHERE created_at > NOW() - INTERVAL '7 days' AND model IS NOT NULL
     GROUP BY model ORDER BY total DESC`
  );

  return NextResponse.json({
    totals24h: totals24h.rows,
    daily: daily.rows,
    byUser: byUser.rows,
    byModel: byModel.rows,
  });
}
