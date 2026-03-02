import { NextResponse } from "next/server";
import pool from "@/lib/db";

// Recall.ai sends real-time transcription and meeting-end events here
export async function POST(req: Request) {
  try {
    const body = await req.json();

    // Real-time transcription event
    if (body.data?.transcript) {
      const { transcript } = body.data;
      const botId = body.data?.bot_id;

      // Find the call_transcript by bot ID in assistant_notes
      if (botId) {
        await pool.query(
          `UPDATE call_transcripts
           SET transcript = COALESCE(transcript, '') || $1,
               status = 'in_progress'
           WHERE assistant_notes LIKE $2`,
          [
            `\n${transcript.speaker}: ${transcript.words.map((w: any) => w.text).join(" ")}`,
            `%${botId}%`,
          ]
        );
      }
    }

    // Meeting ended event
    if (body.event === "bot.done" || body.data?.status?.code === "done") {
      const botId = body.data?.bot_id || body.data?.id;

      if (botId) {
        // Fetch full transcript from Recall API
        const RECALL_API_KEY = process.env.RECALL_AI_API_KEY;
        if (RECALL_API_KEY) {
          const transcriptRes = await fetch(
            `https://us-west-2.recall.ai/api/v1/bot/${botId}/transcript`,
            { headers: { "Authorization": `Token ${RECALL_API_KEY}` } }
          );

          if (transcriptRes.ok) {
            const transcriptData = await transcriptRes.json();
            const fullTranscript = transcriptData
              .map((seg: any) => `${seg.speaker}: ${seg.words.map((w: any) => w.text).join(" ")}`)
              .join("\n");

            // Update the call_transcript record
            await pool.query(
              `UPDATE call_transcripts
               SET transcript = $1,
                   status = 'completed',
                   duration_seconds = $2
               WHERE assistant_notes LIKE $3`,
              [
                fullTranscript,
                body.data?.meeting_metadata?.duration || 0,
                `%${botId}%`,
              ]
            );
          }
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("Recall webhook error:", e);
    return NextResponse.json({ ok: true }); // Always 200
  }
}
