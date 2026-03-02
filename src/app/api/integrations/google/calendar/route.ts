import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helpers";
import pool from "@/lib/db";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

async function getAccessToken(): Promise<string | null> {
  const expiresResult = await pool.query(
    `SELECT value FROM settings WHERE workspace_id = 'default' AND key = 'google_token_expires'`
  );
  const tokenResult = await pool.query(
    `SELECT value FROM settings WHERE workspace_id = 'default' AND key = 'google_access_token'`
  );
  const refreshResult = await pool.query(
    `SELECT value FROM settings WHERE workspace_id = 'default' AND key = 'google_refresh_token'`
  );

  if (!tokenResult.rows[0]?.value) return null;

  const expiresAt = expiresResult.rows[0]?.value;
  if (expiresAt && new Date(expiresAt) > new Date()) {
    return tokenResult.rows[0].value;
  }

  // Refresh token
  const refreshToken = refreshResult.rows[0]?.value;
  if (!refreshToken || !GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) return null;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) return null;

  const tokens = await res.json();
  await pool.query(
    `UPDATE settings SET value = $1 WHERE workspace_id = 'default' AND key = 'google_access_token'`,
    [tokens.access_token]
  );
  const newExpiry = new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString();
  await pool.query(
    `UPDATE settings SET value = $1 WHERE workspace_id = 'default' AND key = 'google_token_expires'`,
    [newExpiry]
  );

  return tokens.access_token;
}

// GET: Fetch events or list calendars
// ?action=listCalendars → returns all user calendars
// ?calendarId=xxx&timeMin=...&timeMax=... → returns events from a specific calendar
export async function GET(req: Request) {
  try {
    await requireAuth();

    const accessToken = await getAccessToken();
    if (!accessToken) {
      return NextResponse.json({ error: "Google not connected", connected: false }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const action = searchParams.get("action");

    // List all user calendars
    if (action === "listCalendars") {
      const calListRes = await fetch(
        "https://www.googleapis.com/calendar/v3/users/me/calendarList",
        { headers: { "Authorization": `Bearer ${accessToken}` } }
      );

      if (!calListRes.ok) {
        if (calListRes.status === 401) {
          return NextResponse.json({ error: "Token expired", connected: false }, { status: 401 });
        }
        return NextResponse.json({ error: "Calendar API error" }, { status: 502 });
      }

      const calListData = await calListRes.json();
      const calendars = (calListData.items || []).map((cal: any) => ({
        id: cal.id,
        summary: cal.summary,
        description: cal.description || null,
        primary: cal.primary || false,
        backgroundColor: cal.backgroundColor || null,
        foregroundColor: cal.foregroundColor || null,
        accessRole: cal.accessRole,
        selected: cal.selected || false,
      }));

      return NextResponse.json({ calendars, connected: true });
    }

    // Fetch events from a specific calendar (or primary by default)
    const calendarId = searchParams.get("calendarId") || "primary";
    const timeMin = searchParams.get("timeMin") || new Date().toISOString();
    const timeMax = searchParams.get("timeMax") || new Date(Date.now() + 7 * 86400000).toISOString();

    const calUrl = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`);
    calUrl.searchParams.set("timeMin", timeMin);
    calUrl.searchParams.set("timeMax", timeMax);
    calUrl.searchParams.set("singleEvents", "true");
    calUrl.searchParams.set("orderBy", "startTime");
    calUrl.searchParams.set("maxResults", "50");

    const res = await fetch(calUrl.toString(), {
      headers: { "Authorization": `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      if (res.status === 401) {
        return NextResponse.json({ error: "Token expired", connected: false }, { status: 401 });
      }
      return NextResponse.json({ error: "Calendar API error" }, { status: 502 });
    }

    const data = await res.json();

    const events = (data.items || []).map((ev: any) => ({
      id: ev.id,
      calendarId,
      title: ev.summary || "(No title)",
      description: ev.description || null,
      start_time: ev.start?.dateTime || ev.start?.date,
      end_time: ev.end?.dateTime || ev.end?.date,
      location: ev.location || null,
      hangoutLink: ev.hangoutLink || null,
      attendees: (ev.attendees || []).map((a: any) => ({
        email: a.email,
        name: a.displayName,
        status: a.responseStatus,
      })),
      source: "google",
    }));

    return NextResponse.json({ events, connected: true });
  } catch (e: any) {
    if (e.message === "Unauthorized") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    console.error("Google Calendar GET error:", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// POST: Create event in Google Calendar
export async function POST(req: Request) {
  try {
    await requireAuth();

    const accessToken = await getAccessToken();
    if (!accessToken) {
      return NextResponse.json({ error: "Google not connected" }, { status: 403 });
    }

    const { title, description, startTime, endTime, location, attendees, calendarId } = await req.json();

    if (!title || !startTime || !endTime) {
      return NextResponse.json({ error: "title, startTime, and endTime required" }, { status: 400 });
    }

    const targetCalendar = calendarId || "primary";

    const eventBody: any = {
      summary: title,
      description: description || undefined,
      location: location || undefined,
      start: { dateTime: startTime, timeZone: "America/Los_Angeles" },
      end: { dateTime: endTime, timeZone: "America/Los_Angeles" },
    };

    if (attendees && attendees.length > 0) {
      eventBody.attendees = attendees.map((email: string) => ({ email }));
    }

    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(targetCalendar)}/events`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(eventBody),
      }
    );

    if (!res.ok) {
      const errText = await res.text();
      console.error("Google Calendar create error:", errText);
      return NextResponse.json({ error: "Failed to create event" }, { status: 502 });
    }

    const eventData = await res.json();

    // Also save locally
    await pool.query(
      `INSERT INTO calendar_events
        (workspace_id, title, description, start_time, end_time, event_type, calendar_type, location, created_by)
       VALUES ('default', $1, $2, $3, $4, 'meeting', 'business', $5, 'human')`,
      [title, description || null, startTime, endTime, location || null]
    );

    return NextResponse.json({
      id: eventData.id,
      calendarId: targetCalendar,
      htmlLink: eventData.htmlLink,
      created: true,
    });
  } catch (e: any) {
    if (e.message === "Unauthorized") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    console.error("Google Calendar POST error:", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// PATCH: Update event in Google Calendar
export async function PATCH(req: Request) {
  try {
    await requireAuth();

    const accessToken = await getAccessToken();
    if (!accessToken) {
      return NextResponse.json({ error: "Google not connected" }, { status: 403 });
    }

    const { eventId, calendarId, title, description, startTime, endTime, location, attendees } = await req.json();

    if (!eventId) {
      return NextResponse.json({ error: "eventId required" }, { status: 400 });
    }

    const targetCalendar = calendarId || "primary";
    const updateBody: any = {};
    if (title) updateBody.summary = title;
    if (description !== undefined) updateBody.description = description;
    if (location !== undefined) updateBody.location = location;
    if (startTime) updateBody.start = { dateTime: startTime, timeZone: "America/Los_Angeles" };
    if (endTime) updateBody.end = { dateTime: endTime, timeZone: "America/Los_Angeles" };
    if (attendees) updateBody.attendees = attendees.map((email: string) => ({ email }));

    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(targetCalendar)}/events/${encodeURIComponent(eventId)}`,
      {
        method: "PATCH",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(updateBody),
      }
    );

    if (!res.ok) {
      const errText = await res.text();
      console.error("Google Calendar update error:", errText);
      return NextResponse.json({ error: "Failed to update event" }, { status: 502 });
    }

    const eventData = await res.json();
    return NextResponse.json({ id: eventData.id, updated: true });
  } catch (e: any) {
    if (e.message === "Unauthorized") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    console.error("Google Calendar PATCH error:", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// DELETE: Remove event from Google Calendar
export async function DELETE(req: Request) {
  try {
    await requireAuth();

    const accessToken = await getAccessToken();
    if (!accessToken) {
      return NextResponse.json({ error: "Google not connected" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const eventId = searchParams.get("eventId");
    const calendarId = searchParams.get("calendarId") || "primary";

    if (!eventId) {
      return NextResponse.json({ error: "eventId required" }, { status: 400 });
    }

    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      {
        method: "DELETE",
        headers: { "Authorization": `Bearer ${accessToken}` },
      }
    );

    if (!res.ok && res.status !== 410) {
      return NextResponse.json({ error: "Failed to delete event" }, { status: 502 });
    }

    return NextResponse.json({ deleted: true });
  } catch (e: any) {
    if (e.message === "Unauthorized") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    console.error("Google Calendar DELETE error:", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
