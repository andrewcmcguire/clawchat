import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helpers";
import pool from "@/lib/db";

const RECALL_API_KEY = process.env.RECALL_AI_API_KEY;
const RECALL_BASE_URL = "https://us-west-2.recall.ai/api/v1";

// POST: Create a Recall.ai bot to join a meeting
export async function POST(req: Request) {
  try {
    await requireAuth();
    const { meetingUrl, eventId, title } = await req.json();

    if (!RECALL_API_KEY) {
      return NextResponse.json({ error: "RECALL_AI_API_KEY not configured" }, { status: 503 });
    }

    if (!meetingUrl) {
      return NextResponse.json({ error: "meetingUrl is required" }, { status: 400 });
    }

    const webhookUrl = process.env.NEXT_PUBLIC_APP_URL
      ? `${process.env.NEXT_PUBLIC_APP_URL}/api/integrations/recall/webhook`
      : "https://app.steadybase.io/api/integrations/recall/webhook";

    const res = await fetch(`${RECALL_BASE_URL}/bot`, {
      method: "POST",
      headers: {
        "Authorization": `Token ${RECALL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        meeting_url: meetingUrl,
        bot_name: "Steadybase Notetaker",
        transcription_options: {
          provider: "meeting_captions",
        },
        real_time_transcription: {
          destination_url: webhookUrl,
          partial_results: false,
        },
        metadata: {
          eventId: eventId || null,
          title: title || "Meeting",
        },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("Recall.ai error:", errText);
      return NextResponse.json({ error: "Failed to create Recall bot" }, { status: 502 });
    }

    const botData = await res.json();

    // Store bot reference in DB for tracking
    await pool.query(
      `INSERT INTO call_transcripts
        (workspace_id, title, call_type, status, assistant_joined, assistant_notes, created_at)
       VALUES ($1, $2, 'meeting', 'scheduled', true, $3, NOW())`,
      [
        "default",
        title || "Meeting Recording",
        `Recall.ai bot ID: ${botData.id}`,
      ]
    );

    return NextResponse.json({
      botId: botData.id,
      status: botData.status_changes?.[0]?.code || "created",
    });
  } catch (e: any) {
    if (e.message === "Unauthorized") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    console.error("Recall route error:", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// GET: List bots and their transcripts
export async function GET() {
  try {
    await requireAuth();

    if (!RECALL_API_KEY) {
      return NextResponse.json({ error: "RECALL_AI_API_KEY not configured" }, { status: 503 });
    }

    const res = await fetch(`${RECALL_BASE_URL}/bot?ordering=-created_at&limit=20`, {
      headers: { "Authorization": `Token ${RECALL_API_KEY}` },
    });

    if (!res.ok) {
      return NextResponse.json({ bots: [] });
    }

    const data = await res.json();
    return NextResponse.json({ bots: data.results || [] });
  } catch (e: any) {
    if (e.message === "Unauthorized") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
