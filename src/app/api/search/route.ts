import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

// GET /api/search?q=term — global search across contacts, events, tasks, messages
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q");

  if (!q || q.trim().length < 2) {
    return NextResponse.json({ contacts: [], events: [], tasks: [], messages: [] });
  }

  const term = `%${q.trim()}%`;

  try {
    const [contactsResult, eventsResult, tasksResult, messagesResult] = await Promise.all([
      pool.query(
        "SELECT id, name, email, company, role FROM contacts WHERE workspace_id = 'default' AND (name ILIKE $1 OR email ILIKE $1 OR company ILIKE $1) ORDER BY last_contacted_at DESC NULLS LAST LIMIT 5",
        [term]
      ),
      pool.query(
        "SELECT id, title, start_time, event_type, location FROM calendar_events WHERE workspace_id = 'default' AND (title ILIKE $1 OR description ILIKE $1 OR location ILIKE $1) ORDER BY start_time DESC LIMIT 5",
        [term]
      ),
      pool.query(
        `SELECT pt.id, pt.title, pt.status, pt.priority, c.name as project_name
         FROM project_tasks pt LEFT JOIN channels c ON pt.channel_id = c.id
         WHERE pt.title ILIKE $1 OR pt.description ILIKE $1
         ORDER BY pt.updated_at DESC LIMIT 5`,
        [term]
      ),
      pool.query(
        `SELECT m.id, m.sender, m.content, m.created_at, c.name as project_name
         FROM messages m LEFT JOIN channels c ON m.channel_id = c.id
         WHERE m.content ILIKE $1
         ORDER BY m.created_at DESC LIMIT 5`,
        [term]
      ),
    ]);

    return NextResponse.json({
      contacts: contactsResult.rows,
      events: eventsResult.rows,
      tasks: tasksResult.rows,
      messages: messagesResult.rows,
    });
  } catch (err) {
    console.error("Search error:", err);
    return NextResponse.json({ contacts: [], events: [], tasks: [], messages: [] });
  }
}
