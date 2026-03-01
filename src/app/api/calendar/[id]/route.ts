import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

// PATCH /api/calendar/:id — update event
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();

  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  for (const field of ["title", "description", "start_time", "end_time", "event_type", "calendar_type", "contact_id", "channel_id", "location", "assistant_prep"] as const) {
    if (body[field] !== undefined) {
      fields.push(`${field} = $${idx++}`);
      values.push(body[field]);
    }
  }

  if (fields.length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  try {
    const result = await pool.query(
      `UPDATE calendar_events SET ${fields.join(", ")} WHERE id = $${idx} AND workspace_id = 'default' RETURNING *`,
      [...values, id]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    return NextResponse.json(result.rows[0]);
  } catch (err) {
    console.error("Calendar PATCH error:", err);
    return NextResponse.json({ error: "Failed to update event" }, { status: 500 });
  }
}

// DELETE /api/calendar/:id — delete event
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const result = await pool.query(
      "DELETE FROM calendar_events WHERE id = $1 AND workspace_id = 'default' RETURNING id",
      [id]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    return NextResponse.json({ deleted: true });
  } catch (err) {
    console.error("Calendar DELETE error:", err);
    return NextResponse.json({ error: "Failed to delete event" }, { status: 500 });
  }
}
