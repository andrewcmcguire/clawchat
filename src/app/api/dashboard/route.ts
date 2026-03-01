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
