import { NextResponse } from "next/server";
import pool from "@/lib/db";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || "https://app.steadybase.io/api/integrations/google/auth/callback";

// GET: Handle OAuth callback from Google
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const code = searchParams.get("code");
    const error = searchParams.get("error");

    if (error) {
      return NextResponse.redirect(new URL("/#/settings?google=error", req.url).origin + "/#/settings?google=error");
    }

    if (!code || !GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
      return NextResponse.redirect(new URL("/#/settings?google=error", req.url).origin + "/#/settings?google=error");
    }

    // Exchange code for tokens
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: GOOGLE_REDIRECT_URI,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenRes.ok) {
      console.error("Google token exchange failed:", await tokenRes.text());
      return NextResponse.redirect(new URL("/#/settings?google=error", req.url).origin + "/#/settings?google=error");
    }

    const tokens = await tokenRes.json();

    // Store refresh token in settings
    await pool.query(
      `INSERT INTO settings (workspace_id, key, value)
       VALUES ('default', 'google_refresh_token', $1)
       ON CONFLICT (workspace_id, key) DO UPDATE SET value = $1`,
      [tokens.refresh_token || tokens.access_token]
    );

    // Store access token (short-lived)
    await pool.query(
      `INSERT INTO settings (workspace_id, key, value)
       VALUES ('default', 'google_access_token', $1)
       ON CONFLICT (workspace_id, key) DO UPDATE SET value = $1`,
      [tokens.access_token]
    );

    // Store token expiry
    const expiresAt = new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString();
    await pool.query(
      `INSERT INTO settings (workspace_id, key, value)
       VALUES ('default', 'google_token_expires', $1)
       ON CONFLICT (workspace_id, key) DO UPDATE SET value = $1`,
      [expiresAt]
    );

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://app.steadybase.io";
    return NextResponse.redirect(`${appUrl}/#/settings?google=connected`);
  } catch (e) {
    console.error("Google callback error:", e);
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://app.steadybase.io";
    return NextResponse.redirect(`${appUrl}/#/settings?google=error`);
  }
}
