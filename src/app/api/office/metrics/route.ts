import { NextResponse } from "next/server";
import pool from "@/lib/db";

export async function GET() {
  try {
    // Active workers: Drew is always "active" when there are recent messages
    // Others are idle for now (becomes real with Temporal)
    const recentActivity = await pool.query(
      "SELECT COUNT(*) as cnt FROM messages WHERE sender_type = 'agent' AND created_at > NOW() - INTERVAL '5 minutes'"
    );
    const activeWorkers = parseInt(recentActivity.rows[0].cnt) > 0 ? 1 : 0;

    // Tasks completed today
    const tasksResult = await pool.query(
      "SELECT COUNT(*) as cnt FROM project_tasks WHERE status = 'done' AND updated_at::date = CURRENT_DATE"
    );
    const tasksCompleted = parseInt(tasksResult.rows[0].cnt);

    // Total messages today (rough token proxy: ~250 tokens per message)
    const messagesResult = await pool.query(
      "SELECT COUNT(*) as cnt FROM messages WHERE created_at::date = CURRENT_DATE"
    );
    const messagesToday = parseInt(messagesResult.rows[0].cnt);
    const estimatedTokens = messagesToday * 250;
    const estimatedCost = (estimatedTokens / 1000000) * 15; // rough $15/MTok for Opus

    // Memory health: ratio of non-stale context (messages in last 24h vs total)
    const totalMessages = await pool.query("SELECT COUNT(*) as cnt FROM messages");
    const recentMessages = await pool.query(
      "SELECT COUNT(*) as cnt FROM messages WHERE created_at > NOW() - INTERVAL '24 hours'"
    );
    const total = parseInt(totalMessages.rows[0].cnt) || 1;
    const recent = parseInt(recentMessages.rows[0].cnt);
    const memoryHealth = Math.round((recent / Math.max(total, 1)) * 100);

    return NextResponse.json({
      activeWorkers,
      tasksCompleted,
      estimatedTokens,
      estimatedCost: estimatedCost.toFixed(2),
      memoryHealth: Math.min(memoryHealth, 100),
      messagesToday,
    });
  } catch (error) {
    console.error("Office metrics error:", error);
    return NextResponse.json({
      activeWorkers: 0,
      tasksCompleted: 0,
      estimatedTokens: 0,
      estimatedCost: "0.00",
      memoryHealth: 0,
      messagesToday: 0,
    });
  }
}
