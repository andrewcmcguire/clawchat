import { NextResponse } from "next/server";
import pool from "@/lib/db";

// GET /api/dashboard — aggregated daily briefing
export async function GET() {
  try {
    // Today's events
    const eventsResult = await pool.query(
      "SELECT * FROM calendar_events WHERE workspace_id = 'default' AND start_time::date = CURRENT_DATE ORDER BY start_time ASC"
    );

    // Priority tasks across projects
    const tasksResult = await pool.query(
      `SELECT pt.*, c.name as project_name FROM project_tasks pt
       LEFT JOIN channels c ON pt.channel_id = c.id
       WHERE pt.status IN ('todo', 'in_progress')
       ORDER BY
         CASE pt.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END ASC,
         pt.due_date ASC NULLS LAST
       LIMIT 10`
    );

    // Recent activity
    const activityResult = await pool.query(
      `(SELECT 'message' as type, m.id, m.sender as actor,
         CASE WHEN m.sender_type = 'agent' THEN m.sender || ' replied' ELSE m.sender || ' sent a message' END as description,
         c.name as project_name, m.created_at
       FROM messages m LEFT JOIN channels c ON m.channel_id = c.id
       ORDER BY m.created_at DESC LIMIT 5)
      UNION ALL
      (SELECT 'task' as type, t.id, t.assignee as actor,
         'Task created: ' || t.title as description,
         c.name as project_name, t.created_at
       FROM project_tasks t LEFT JOIN channels c ON t.channel_id = c.id
       ORDER BY t.created_at DESC LIMIT 5)
      ORDER BY created_at DESC LIMIT 10`
    );

    // Stale follow-ups (contacts not contacted in 3+ days)
    const followUpsResult = await pool.query(
      `SELECT * FROM contacts WHERE workspace_id = 'default'
       AND last_contacted_at < NOW() - INTERVAL '3 days'
       ORDER BY last_contacted_at ASC NULLS FIRST LIMIT 10`
    );

    // Pending assistant actions
    const pendingActionsResult = await pool.query(
      `SELECT aa.*, c.name as contact_name FROM assistant_actions aa
       LEFT JOIN contacts c ON aa.target_contact_id = c.id
       WHERE aa.workspace_id = 'default' AND aa.status = 'pending' AND aa.requires_approval = true
       ORDER BY aa.created_at DESC`
    );

    // LLM cost tracking (today)
    let llmCostToday = 0;
    try {
      const costResult = await pool.query(
        `SELECT COALESCE(SUM(tokens_used), 0) as total_tokens, model
         FROM usage_log WHERE workspace_id = 'default' AND created_at::date = CURRENT_DATE
         GROUP BY model`
      );
      for (const row of costResult.rows) {
        const tokens = parseInt(row.total_tokens) || 0;
        const model = (row.model || "").toLowerCase();
        let costPer1k = 0.003; // default
        if (model.includes("opus")) costPer1k = 0.075;
        else if (model.includes("sonnet")) costPer1k = 0.015;
        else if (model.includes("haiku")) costPer1k = 0.001;
        else if (model.includes("gpt-4")) costPer1k = 0.03;
        llmCostToday += (tokens / 1000) * costPer1k;
      }
    } catch { /* usage_log may not exist */ }

    // Project count
    let projectCount = 0;
    try {
      const projResult = await pool.query(
        `SELECT COUNT(*) as count FROM channels WHERE workspace_id = 'default' AND (is_dm IS NULL OR is_dm = false)`
      );
      projectCount = parseInt(projResult.rows[0]?.count) || 0;
    } catch { /* channels table issue */ }

    // Due today count
    let dueTodayCount = 0;
    try {
      const dueResult = await pool.query(
        `SELECT COUNT(*) as count FROM project_tasks
         WHERE status != 'done' AND due_date::date = CURRENT_DATE`
      );
      dueTodayCount = parseInt(dueResult.rows[0]?.count) || 0;
    } catch { /* no due date data */ }

    const events = eventsResult.rows;
    const tasks = tasksResult.rows;
    const followUps = followUpsResult.rows;
    const pendingActions = pendingActionsResult.rows;

    return NextResponse.json({
      events,
      tasks,
      activity: activityResult.rows,
      followUps,
      pendingActions,
      summary: {
        meetingCount: events.length,
        taskCount: tasks.length,
        followUpCount: followUps.length,
        pendingActionCount: pendingActions.length,
        llmCostToday,
        projectCount,
        dueTodayCount,
      },
    });
  } catch (err) {
    console.error("Dashboard GET error:", err);
    return NextResponse.json({
      events: [],
      tasks: [],
      activity: [],
      followUps: [],
      pendingActions: [],
      summary: { meetingCount: 0, taskCount: 0, followUpCount: 0, pendingActionCount: 0 },
    });
  }
}
