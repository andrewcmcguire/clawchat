import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

// GET /api/calendar — list events for a date range
export async function GET(req: NextRequest) {
  const start = req.nextUrl.searchParams.get("start");
  const end = req.nextUrl.searchParams.get("end");
  const type = req.nextUrl.searchParams.get("type");

  try {
    let query = "SELECT ce.*, c.name as contact_name FROM calendar_events ce LEFT JOIN contacts c ON ce.contact_id = c.id WHERE ce.workspace_id = 'default'";
    const values: unknown[] = [];
    let idx = 1;

    if (start) {
      query += ` AND start_time >= $${idx}`;
      values.push(start);
      idx++;
    }

    if (end) {
      query += ` AND start_time <= $${idx}`;
      values.push(end);
      idx++;
    }

    if (type && type !== "all") {
      const types = type.split(",");
      query += ` AND calendar_type = ANY($${idx})`;
      values.push(types);
      idx++;
    }

    query += " ORDER BY start_time ASC";

    const result = await pool.query(query, values);
    return NextResponse.json(result.rows);
  } catch (err) {
    console.error("Calendar GET error:", err);
    return NextResponse.json([]);
  }
}

// POST /api/calendar — create event
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { title, description, start_time, end_time, event_type = "meeting", calendar_type = "business", contact_id, channel_id, location } = body;

  if (!title || !start_time || !end_time) {
    return NextResponse.json({ error: "title, start_time, and end_time are required" }, { status: 400 });
  }

  try {
    const result = await pool.query(
      `INSERT INTO calendar_events (workspace_id, title, description, start_time, end_time, event_type, calendar_type, contact_id, channel_id, location)
       VALUES ('default', $1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [title, description || null, start_time, end_time, event_type, calendar_type, contact_id || null, channel_id || null, location || null]
    );

    return NextResponse.json(result.rows[0], { status: 201 });
  } catch (err) {
    console.error("Calendar POST error:", err);
    return NextResponse.json({ error: "Failed to create event" }, { status: 500 });
  }
}
