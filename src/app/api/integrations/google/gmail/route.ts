import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helpers";
import pool from "@/lib/db";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

async function getAccessToken(): Promise<string | null> {
  // Check if token is still valid
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

  // Token expired — refresh it
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

  // Update stored tokens
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

// GET: Fetch recent emails
export async function GET(req: Request) {
  try {
    await requireAuth();

    const accessToken = await getAccessToken();
    if (!accessToken) {
      return NextResponse.json({ error: "Google not connected", connected: false }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const maxResults = searchParams.get("maxResults") || "10";
    const q = searchParams.get("q") || "";

    // List messages
    const listUrl = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
    listUrl.searchParams.set("maxResults", maxResults);
    if (q) listUrl.searchParams.set("q", q);

    const listRes = await fetch(listUrl.toString(), {
      headers: { "Authorization": `Bearer ${accessToken}` },
    });

    if (!listRes.ok) {
      if (listRes.status === 401) {
        return NextResponse.json({ error: "Token expired", connected: false }, { status: 401 });
      }
      return NextResponse.json({ error: "Gmail API error" }, { status: 502 });
    }

    const listData = await listRes.json();
    const messageIds = (listData.messages || []).slice(0, 10);

    // Fetch each message's details
    const emails = await Promise.all(
      messageIds.map(async (msg: { id: string }) => {
        const msgRes = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
          { headers: { "Authorization": `Bearer ${accessToken}` } }
        );
        if (!msgRes.ok) return null;
        const msgData = await msgRes.json();

        const headers = msgData.payload?.headers || [];
        const getHeader = (name: string) => headers.find((h: any) => h.name === name)?.value || "";

        return {
          id: msgData.id,
          threadId: msgData.threadId,
          from: getHeader("From"),
          subject: getHeader("Subject"),
          date: getHeader("Date"),
          snippet: msgData.snippet,
          unread: (msgData.labelIds || []).includes("UNREAD"),
        };
      })
    );

    // Get unread count
    const unreadRes = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/labels/UNREAD",
      { headers: { "Authorization": `Bearer ${accessToken}` } }
    );
    let unreadCount = 0;
    if (unreadRes.ok) {
      const unreadData = await unreadRes.json();
      unreadCount = unreadData.messagesTotal || 0;
    }

    return NextResponse.json({
      emails: emails.filter(Boolean),
      unreadCount,
      connected: true,
    });
  } catch (e: any) {
    if (e.message === "Unauthorized") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    console.error("Gmail GET error:", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// POST: Send email
export async function POST(req: Request) {
  try {
    await requireAuth();

    const accessToken = await getAccessToken();
    if (!accessToken) {
      return NextResponse.json({ error: "Google not connected" }, { status: 403 });
    }

    const { to, subject, body, replyTo } = await req.json();

    if (!to || !subject || !body) {
      return NextResponse.json({ error: "to, subject, and body are required" }, { status: 400 });
    }

    // Build raw email
    const emailLines = [
      `To: ${to}`,
      `Subject: ${subject}`,
      "Content-Type: text/plain; charset=utf-8",
      "MIME-Version: 1.0",
    ];
    if (replyTo) {
      emailLines.push(`In-Reply-To: ${replyTo}`);
      emailLines.push(`References: ${replyTo}`);
    }
    emailLines.push("", body);

    const rawEmail = emailLines.join("\r\n");
    const encodedEmail = Buffer.from(rawEmail).toString("base64url");

    const sendRes = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ raw: encodedEmail }),
      }
    );

    if (!sendRes.ok) {
      const errText = await sendRes.text();
      console.error("Gmail send error:", errText);
      return NextResponse.json({ error: "Failed to send email" }, { status: 502 });
    }

    const sendData = await sendRes.json();

    // Log the action
    await pool.query(
      `INSERT INTO usage_log (workspace_id, action, model, tokens_used)
       VALUES ('default', 'gmail_send', 'gmail', 0)`
    );

    return NextResponse.json({
      messageId: sendData.id,
      threadId: sendData.threadId,
      sent: true,
    });
  } catch (e: any) {
    if (e.message === "Unauthorized") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    console.error("Gmail POST error:", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// PATCH: Mark as read, archive, etc.
export async function PATCH(req: Request) {
  try {
    await requireAuth();

    const accessToken = await getAccessToken();
    if (!accessToken) {
      return NextResponse.json({ error: "Google not connected" }, { status: 403 });
    }

    const { messageId, action } = await req.json();

    if (!messageId || !action) {
      return NextResponse.json({ error: "messageId and action required" }, { status: 400 });
    }

    let modifyBody: any = {};
    if (action === "read") {
      modifyBody = { removeLabelIds: ["UNREAD"] };
    } else if (action === "unread") {
      modifyBody = { addLabelIds: ["UNREAD"] };
    } else if (action === "archive") {
      modifyBody = { removeLabelIds: ["INBOX"] };
    }

    const res = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/modify`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(modifyBody),
      }
    );

    if (!res.ok) {
      return NextResponse.json({ error: "Gmail modify failed" }, { status: 502 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    if (e.message === "Unauthorized") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
