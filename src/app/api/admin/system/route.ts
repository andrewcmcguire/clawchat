import { NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";

export async function GET() {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Table row counts
  const tables = ["users", "messages", "channels", "contacts", "calendar_events", "project_tasks", "project_files", "project_skills", "audit_log", "usage_log"];
  const counts: Record<string, number> = {};

  for (const table of tables) {
    const result = await pool.query(`SELECT COUNT(*) FROM ${table}`);
    counts[table] = parseInt(result.rows[0].count);
  }

  // DB pool stats
  const poolStats = {
    totalCount: (pool as any).totalCount || 0,
    idleCount: (pool as any).idleCount || 0,
    waitingCount: (pool as any).waitingCount || 0,
  };

  return NextResponse.json({
    tableCounts: counts,
    pool: poolStats,
    server: {
      nodeVersion: process.version,
      uptime: Math.floor(process.uptime()),
      memoryUsage: process.memoryUsage(),
      platform: process.platform,
    },
  });
}
