import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { requireAuth } from "@/lib/auth-helpers";

export async function GET() {
  try {
    await requireAuth();

    // Aggregate usage_log by time period and model
    const today = await pool.query(`
      SELECT COALESCE(SUM(tokens_used), 0) as total_tokens,
             model,
             COUNT(*) as request_count
      FROM usage_log
      WHERE created_at >= CURRENT_DATE
      GROUP BY model
    `);

    const week = await pool.query(`
      SELECT COALESCE(SUM(tokens_used), 0) as total_tokens,
             model,
             COUNT(*) as request_count
      FROM usage_log
      WHERE created_at >= DATE_TRUNC('week', CURRENT_DATE)
      GROUP BY model
    `);

    const month = await pool.query(`
      SELECT COALESCE(SUM(tokens_used), 0) as total_tokens,
             model,
             COUNT(*) as request_count
      FROM usage_log
      WHERE created_at >= DATE_TRUNC('month', CURRENT_DATE)
      GROUP BY model
    `);

    // Cost estimates (approximate per-token costs)
    const costPerToken: Record<string, number> = {
      "claude-opus-4-6": 0.000015,
      "claude-sonnet-4-6": 0.000003,
      "gpt-4o": 0.000005,
      "gemini-pro": 0.0000005,
    };

    function calcCost(rows: any[]) {
      return rows.reduce((sum, r) => {
        const rate = costPerToken[r.model] || 0.000003;
        return sum + r.total_tokens * rate;
      }, 0);
    }

    return NextResponse.json({
      today: {
        cost: calcCost(today.rows),
        tokens: today.rows.reduce((s: number, r: any) => s + Number(r.total_tokens), 0),
        byModel: today.rows,
      },
      week: {
        cost: calcCost(week.rows),
        tokens: week.rows.reduce((s: number, r: any) => s + Number(r.total_tokens), 0),
        byModel: week.rows,
      },
      month: {
        cost: calcCost(month.rows),
        tokens: month.rows.reduce((s: number, r: any) => s + Number(r.total_tokens), 0),
        byModel: month.rows,
      },
    });
  } catch (e: any) {
    if (e.message === "Unauthorized") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
