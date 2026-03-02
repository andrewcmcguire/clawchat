import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helpers";
import pool from "@/lib/db";

const VAPI_API_KEY = process.env.VAPI_API_KEY;
const VAPI_BASE_URL = "https://api.vapi.ai";

export async function POST(req: Request) {
  try {
    const session = await requireAuth();
    const { projectId } = await req.json();

    if (!VAPI_API_KEY) {
      return NextResponse.json({ error: "VAPI_API_KEY not configured" }, { status: 503 });
    }

    // Get Drew's system prompt from memory
    const memResult = await pool.query(
      `SELECT value FROM memory_entries WHERE scope = 'worker' AND scope_id = 'drew' AND key = 'personality' LIMIT 1`
    );
    const drewPersonality = memResult.rows[0]?.value || "You are Drew, a helpful AI assistant.";

    // Get active skills for the project
    let skillContext = "";
    if (projectId) {
      const skillResult = await pool.query(
        `SELECT name, content FROM project_skills WHERE channel_id = $1 AND active = true`,
        [projectId]
      );
      if (skillResult.rows.length > 0) {
        skillContext = "\n\nActive skills:\n" + skillResult.rows.map((s: any) => `- ${s.name}: ${s.content}`).join("\n");
      }
    }

    // Create a Vapi web call
    const vapiRes = await fetch(`${VAPI_BASE_URL}/call/web`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${VAPI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        assistant: {
          name: "Drew",
          model: {
            provider: "anthropic",
            model: "claude-sonnet-4-5-20250929",
            messages: [
              {
                role: "system",
                content: `${drewPersonality}\n\nYou are speaking with ${session.user.name || session.user.email}. Be conversational, concise, and helpful. You are their AI executive assistant.${skillContext}`,
              },
            ],
          },
          voice: {
            provider: "11labs",
            voiceId: "pNInz6obpgDQGcFmaJgB", // Adam voice
          },
          firstMessage: `Hey ${session.user.name?.split(" ")[0] || "there"}, what can I help with?`,
        },
        metadata: {
          userId: session.user.email,
          projectId: projectId || "general",
        },
      }),
    });

    if (!vapiRes.ok) {
      const errText = await vapiRes.text();
      console.error("Vapi error:", errText);
      return NextResponse.json({ error: "Failed to create Vapi call" }, { status: 502 });
    }

    const vapiData = await vapiRes.json();
    return NextResponse.json({
      callId: vapiData.id,
      webCallUrl: vapiData.webCallUrl,
      status: vapiData.status,
    });
  } catch (e: any) {
    if (e.message === "Unauthorized") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    console.error("Vapi route error:", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// GET: List recent calls
export async function GET() {
  try {
    await requireAuth();
    const result = await pool.query(
      `SELECT id, title, duration_seconds, recap, call_type, status, created_at
       FROM call_transcripts
       ORDER BY created_at DESC LIMIT 20`
    );
    return NextResponse.json(result.rows);
  } catch (e: any) {
    if (e.message === "Unauthorized") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
