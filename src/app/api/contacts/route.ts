import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

// GET /api/contacts — list contacts with search
export async function GET(req: NextRequest) {
  const search = req.nextUrl.searchParams.get("search");
  const company = req.nextUrl.searchParams.get("company");

  try {
    let query = "SELECT * FROM contacts WHERE workspace_id = 'default'";
    const values: unknown[] = [];
    let idx = 1;

    if (search) {
      query += ` AND (name ILIKE $${idx} OR company ILIKE $${idx} OR email ILIKE $${idx})`;
      values.push(`%${search}%`);
      idx++;
    }

    if (company) {
      query += ` AND company ILIKE $${idx}`;
      values.push(`%${company}%`);
      idx++;
    }

    query += " ORDER BY last_contacted_at DESC NULLS LAST";

    const result = await pool.query(query, values);
    return NextResponse.json(result.rows);
  } catch (err) {
    console.error("Contacts GET error:", err);
    return NextResponse.json([]);
  }
}

// POST /api/contacts — create contact
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { name, email, phone, company, role, linkedin_url, channels, notes } = body;

  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  try {
    const result = await pool.query(
      `INSERT INTO contacts (workspace_id, name, email, phone, company, role, linkedin_url, channels, notes)
       VALUES ('default', $1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [name, email || null, phone || null, company || null, role || null, linkedin_url || null, channels || '{}', notes || null]
    );

    return NextResponse.json(result.rows[0], { status: 201 });
  } catch (err) {
    console.error("Contact POST error:", err);
    return NextResponse.json({ error: "Failed to create contact" }, { status: 500 });
  }
}
