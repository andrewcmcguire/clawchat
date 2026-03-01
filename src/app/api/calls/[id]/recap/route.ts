import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import Anthropic from "@anthropic-ai/sdk";
import { callProvider } from "@/lib/llm-router";

// POST /api/calls/:id/recap — AI-generate recap + action items
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const result = await pool.query(
      "SELECT * FROM call_transcripts WHERE id = $1 AND workspace_id = 'default'",
      [id]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "Call not found" }, { status: 404 });
    }

    const call = result.rows[0];

    if (!call.transcript) {
      return NextResponse.json({ error: "No transcript available" }, { status: 400 });
    }

    const anthropic = new Anthropic();

    const systemPrompt = `You are a business call summarizer. Given a call transcript, produce:
1. A concise recap (2-3 sentences) covering key points and outcomes
2. A JSON array of action items, each with "task" and "due" fields

Respond in this exact format:
RECAP: [your recap here]
ACTION_ITEMS: [{"task": "...", "due": "..."}, ...]`;

    const response = await callProvider(
      "claude-sonnet",
      systemPrompt,
      [{ role: "user", content: `Call: ${call.title}\n\nTranscript:\n${call.transcript}` }],
      anthropic
    );

    const text = response.text;
    const recapMatch = text.match(/RECAP:\s*([\s\S]*?)(?=ACTION_ITEMS:|$)/);
    const actionsMatch = text.match(/ACTION_ITEMS:\s*(\[[\s\S]*?\])/);

    const recap = recapMatch ? recapMatch[1].trim() : text;
    let action_items: unknown[] = [];
    try {
      if (actionsMatch) action_items = JSON.parse(actionsMatch[1]);
    } catch { /* parse failed, keep empty */ }

    await pool.query(
      "UPDATE call_transcripts SET recap = $1, action_items = $2 WHERE id = $3",
      [recap, JSON.stringify(action_items), id]
    );

    return NextResponse.json({ recap, action_items });
  } catch (err) {
    console.error("Recap generation error:", err);
    return NextResponse.json({ error: "Failed to generate recap" }, { status: 500 });
  }
}
