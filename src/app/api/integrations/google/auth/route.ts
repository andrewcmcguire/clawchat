import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helpers";
import pool from "@/lib/db";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || "https://app.steadybase.io/api/integrations/google/auth/callback";

// GET: Initiate OAuth flow — redirect to Google consent screen
export async function GET() {
  try {
    await requireAuth();

    if (!GOOGLE_CLIENT_ID) {
      return NextResponse.json({ error: "GOOGLE_CLIENT_ID not configured" }, { status: 503 });
    }

    const scopes = [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/calendar.readonly",
      "https://www.googleapis.com/auth/calendar.events",
    ].join(" ");

    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.searchParams.set("client_id", GOOGLE_CLIENT_ID);
    authUrl.searchParams.set("redirect_uri", GOOGLE_REDIRECT_URI);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", scopes);
    authUrl.searchParams.set("access_type", "offline");
    authUrl.searchParams.set("prompt", "consent");

    return NextResponse.redirect(authUrl.toString());
  } catch (e: any) {
    if (e.message === "Unauthorized") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// POST: Check connection status
export async function POST() {
  try {
    const session = await requireAuth();

    const result = await pool.query(
      `SELECT value FROM settings WHERE workspace_id = 'default' AND key = 'google_refresh_token'`
    );

    const connected = result.rows.length > 0 && result.rows[0].value;

    return NextResponse.json({
      connected: !!connected,
      scopes: connected ? ["gmail", "calendar"] : [],
    });
  } catch (e: any) {
    if (e.message === "Unauthorized") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
