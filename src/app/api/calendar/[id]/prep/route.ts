import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import Anthropic from "@anthropic-ai/sdk";
import { callProvider } from "@/lib/llm-router";

// POST /api/calendar/:id/prep — generate meeting prep using Drew
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    // Load event
    const eventResult = await pool.query(
      "SELECT * FROM calendar_events WHERE id = $1 AND workspace_id = 'default'",
      [id]
    );

    if (eventResult.rows.length === 0) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    const event = eventResult.rows[0];

    // Load contact context if there's a linked contact
    let contactContext = "";
    if (event.contact_id) {
      const contactResult = await pool.query(
        "SELECT * FROM contacts WHERE id = $1",
        [event.contact_id]
      );
      if (contactResult.rows.length > 0) {
        const contact = contactResult.rows[0];
        contactContext += `\nContact: ${contact.name}`;
        if (contact.company) contactContext += ` at ${contact.company}`;
        if (contact.role) contactContext += ` (${contact.role})`;
        if (contact.notes) contactContext += `\nNotes: ${contact.notes}`;

        // Get recent interactions
        const interactionsResult = await pool.query(
          "SELECT type, summary, initiated_by, created_at FROM contact_interactions WHERE contact_id = $1 ORDER BY created_at DESC LIMIT 5",
          [event.contact_id]
        );
        if (interactionsResult.rows.length > 0) {
          contactContext += "\n\nRecent interactions:";
          for (const int of interactionsResult.rows) {
            contactContext += `\n- [${int.type}] ${int.summary} (${int.initiated_by === "assistant" ? "by Drew" : "by human"}, ${new Date(int.created_at).toLocaleDateString()})`;
          }
        }

        // Get recent call recaps
        const callsResult = await pool.query(
          "SELECT title, recap FROM call_transcripts WHERE contact_id = $1 AND recap IS NOT NULL ORDER BY created_at DESC LIMIT 2",
          [event.contact_id]
        );
        if (callsResult.rows.length > 0) {
          contactContext += "\n\nRecent call recaps:";
          for (const call of callsResult.rows) {
            contactContext += `\n- ${call.title}: ${call.recap}`;
          }
        }
      }
    }

    // Load relevant memory entries
    const memoryResult = await pool.query(
      "SELECT key, value FROM memory_entries WHERE workspace_id = 'default' AND (scope = 'org' OR scope = 'team') AND pinned = true ORDER BY updated_at DESC LIMIT 5"
    );
    let memoryContext = "";
    if (memoryResult.rows.length > 0) {
      memoryContext = "\n\nRelevant org context:\n" + memoryResult.rows.map((m) => `- ${m.key}: ${m.value}`).join("\n");
    }

    const anthropic = new Anthropic();

    const systemPrompt = `You are Drew, an AI executive assistant preparing a meeting briefing. Be concise, actionable, and direct. Structure your prep as:

1. **Key Context** — Who they are, what matters to them
2. **Last Interaction** — What happened, any open items
3. **Talking Points** — 3-4 specific things to discuss
4. **Watch For** — Any risks, sensitivities, or opportunities
5. **Suggested Outcome** — What to aim for in this meeting`;

    const userMessage = `Prepare me for this meeting:

Event: ${event.title}
Type: ${event.event_type}
Time: ${new Date(event.start_time).toLocaleString()} - ${new Date(event.end_time).toLocaleString()}
${event.description ? `Description: ${event.description}` : ""}
${event.location ? `Location: ${event.location}` : ""}
${contactContext}
${memoryContext}`;

    const response = await callProvider(
      "claude-sonnet",
      systemPrompt,
      [{ role: "user", content: userMessage }],
      anthropic
    );

    // Save prep to event
    await pool.query(
      "UPDATE calendar_events SET assistant_prep = $1 WHERE id = $2",
      [response.text, id]
    );

    return NextResponse.json({ prep: response.text });
  } catch (err) {
    console.error("Prep generation error:", err);
    return NextResponse.json({ error: "Failed to generate prep" }, { status: 500 });
  }
}
