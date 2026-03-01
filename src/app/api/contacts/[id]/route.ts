import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

// GET /api/contacts/:id — contact detail with interactions and calls
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const contactResult = await pool.query(
      "SELECT * FROM contacts WHERE id = $1 AND workspace_id = 'default'",
      [id]
    );

    if (contactResult.rows.length === 0) {
      return NextResponse.json({ error: "Contact not found" }, { status: 404 });
    }

    const interactionsResult = await pool.query(
      "SELECT * FROM contact_interactions WHERE contact_id = $1 ORDER BY created_at DESC LIMIT 20",
      [id]
    );

    const callsResult = await pool.query(
      "SELECT * FROM call_transcripts WHERE contact_id = $1 ORDER BY created_at DESC",
      [id]
    );

    return NextResponse.json({
      ...contactResult.rows[0],
      interactions: interactionsResult.rows,
      calls: callsResult.rows,
    });
  } catch (err) {
    console.error("Contact detail GET error:", err);
    return NextResponse.json({ error: "Failed to load contact" }, { status: 500 });
  }
}

// PATCH /api/contacts/:id — update contact fields
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();

  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  for (const field of ["name", "email", "phone", "company", "role", "linkedin_url", "channels", "notes"] as const) {
    if (body[field] !== undefined) {
      fields.push(`${field} = $${idx++}`);
      values.push(body[field]);
    }
  }

  if (fields.length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  fields.push("updated_at = NOW()");

  try {
    const result = await pool.query(
      `UPDATE contacts SET ${fields.join(", ")} WHERE id = $${idx} AND workspace_id = 'default' RETURNING *`,
      [...values, id]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "Contact not found" }, { status: 404 });
    }

    return NextResponse.json(result.rows[0]);
  } catch (err) {
    console.error("Contact PATCH error:", err);
    return NextResponse.json({ error: "Failed to update contact" }, { status: 500 });
  }
}

// DELETE /api/contacts/:id — cascade delete
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const result = await pool.query(
      "DELETE FROM contacts WHERE id = $1 AND workspace_id = 'default' RETURNING id",
      [id]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "Contact not found" }, { status: 404 });
    }

    return NextResponse.json({ deleted: true });
  } catch (err) {
    console.error("Contact DELETE error:", err);
    return NextResponse.json({ error: "Failed to delete contact" }, { status: 500 });
  }
}
