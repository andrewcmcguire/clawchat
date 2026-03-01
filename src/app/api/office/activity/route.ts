import { NextResponse } from "next/server";
import pool from "@/lib/db";

export async function GET() {
  try {
    // Union of recent messages, approvals, and task changes
    const result = await pool.query(`
      (
        SELECT
          'message' as type,
          m.id,
          m.sender as actor,
          CASE
            WHEN m.sender_type = 'agent' THEN m.sender || ' replied in ' || c.name
            ELSE m.sender || ' sent a message in ' || c.name
          END as description,
          c.name as project_name,
          m.created_at
        FROM messages m
        JOIN channels c ON c.id = m.channel_id
        ORDER BY m.created_at DESC
        LIMIT 25
      )
      UNION ALL
      (
        SELECT
          'approval' as type,
          a.id,
          a.requested_by as actor,
          CASE
            WHEN a.status = 'pending' THEN 'Approval requested: ' || a.title
            WHEN a.status = 'approved' THEN a.title || ' was approved'
            ELSE a.title || ' was rejected'
          END as description,
          c.name as project_name,
          a.created_at
        FROM approvals a
        JOIN channels c ON c.id = a.channel_id
        ORDER BY a.created_at DESC
        LIMIT 15
      )
      UNION ALL
      (
        SELECT
          'task' as type,
          t.id,
          COALESCE(t.assignee, 'System') as actor,
          'Task created: ' || t.title as description,
          c.name as project_name,
          t.created_at
        FROM project_tasks t
        JOIN channels c ON c.id = t.channel_id
        ORDER BY t.created_at DESC
        LIMIT 15
      )
      ORDER BY created_at DESC
      LIMIT 50
    `);

    return NextResponse.json(result.rows);
  } catch (error) {
    console.error("Office activity error:", error);
    return NextResponse.json([]);
  }
}
