import { NextResponse } from "next/server";
import pool from "@/lib/db";

// Vapi sends webhook events here when calls start, end, or transcripts are ready
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { message } = body;

    if (!message) {
      return NextResponse.json({ ok: true });
    }

    const eventType = message.type;

    if (eventType === "end-of-call-report") {
      // Call ended — save transcript
      const {
        call,
        transcript,
        summary,
        recordingUrl,
      } = message;

      const userId = call?.metadata?.userId || "unknown";
      const projectId = call?.metadata?.projectId || "general";
      const duration = call?.endedAt && call?.startedAt
        ? Math.round((new Date(call.endedAt).getTime() - new Date(call.startedAt).getTime()) / 1000)
        : 0;

      // Extract action items from summary if available
      const actionItems: string[] = [];
      if (summary) {
        const actionMatches = summary.match(/(?:action item|todo|follow.?up|next step)[s]?:?\s*(.+)/gi);
        if (actionMatches) {
          actionMatches.forEach((m: string) => actionItems.push(m.trim()));
        }
      }

      // Save to call_transcripts
      await pool.query(
        `INSERT INTO call_transcripts
          (workspace_id, title, duration_seconds, transcript, recap, action_items, call_type, status, assistant_joined, assistant_notes, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
        [
          "default",
          `Voice call with ${userId}`,
          duration,
          transcript || null,
          summary || null,
          JSON.stringify(actionItems),
          "voice",
          "completed",
          true,
          recordingUrl ? `Recording: ${recordingUrl}` : null,
        ]
      );

      // Create tasks from action items
      if (actionItems.length > 0) {
        for (const item of actionItems.slice(0, 5)) {
          await pool.query(
            `INSERT INTO project_tasks (channel_id, title, description, status, priority, assignee)
             VALUES ($1, $2, $3, 'todo', 'medium', NULL)`,
            [projectId, item, `Auto-created from voice call with Drew`]
          );
        }
      }
    }

    if (eventType === "transcript") {
      // Real-time transcript chunk — could broadcast via SSE if needed
      // For now just log
      console.log("[Vapi transcript]", message.transcript?.text);
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("Vapi webhook error:", e);
    return NextResponse.json({ ok: true }); // Always return 200 to Vapi
  }
}
