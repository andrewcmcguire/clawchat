import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { agents } from "@/lib/agents";
import { broadcast } from "@/lib/sse";
import { routeToLLM } from "@/lib/llm-router";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Detect task markers in Drew's response and create them on the board
async function extractAndCreateTasks(content: string, channelId: string): Promise<number> {
  const taskPattern = /\[TASK:\s*(.+?)\s*\|\s*priority:\s*(low|medium|high|urgent)\s*\|\s*status:\s*(backlog|todo|in_progress|review|done)\s*\]/gi;
  let match;
  let count = 0;

  while ((match = taskPattern.exec(content)) !== null) {
    const title = match[1].trim();
    const priority = match[2].toLowerCase();
    const status = match[3].toLowerCase();

    try {
      const posResult = await pool.query(
        "SELECT COALESCE(MAX(position), -1) + 1 as next_pos FROM project_tasks WHERE channel_id = $1 AND status = $2",
        [channelId, status]
      );
      const position = posResult.rows[0].next_pos;

      await pool.query(
        `INSERT INTO project_tasks (channel_id, title, status, priority, assignee, position)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [channelId, title, status, priority, "Drew", position]
      );
      count++;
    } catch (err) {
      console.error("Failed to create task:", err);
    }
  }

  if (count > 0) {
    broadcast({ type: "tasks_created", channel_id: channelId, count });
  }

  return count;
}

// Detect if the agent response contains something that should be an approval card
function detectApproval(
  content: string,
  agentName: string
): { title: string; description: string } | null {
  const approvalPatterns = [
    /(?:I recommend|I suggest|I propose|shall I|should I|want me to|I'll go ahead and|let me)\s+(.{10,100})/i,
    /(?:approval needed|needs approval|requires sign-off|action required)[:\s]+(.{10,100})/i,
    /(?:deploy|launch|publish|release|merge|ship)\s+(.{10,80})/i,
  ];

  for (const pattern of approvalPatterns) {
    const match = content.match(pattern);
    if (match) {
      return {
        title: `${agentName}: Action Requested`,
        description: match[1].trim().replace(/[.!?]+$/, ""),
      };
    }
  }
  return null;
}

export async function GET(req: NextRequest) {
  const channelId = req.nextUrl.searchParams.get("channel_id") || "general";

  const result = await pool.query(
    `SELECT m.*, a.id as approval_id, a.title as approval_title,
            a.description as approval_description, a.status as approval_status,
            a.resolved_by, a.resolved_at
     FROM messages m
     LEFT JOIN approvals a ON a.message_id = m.id
     WHERE m.channel_id = $1
     ORDER BY m.created_at ASC LIMIT 100`,
    [channelId]
  );

  return NextResponse.json(result.rows);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { content, channel_id = "general", sender = "You" } = body;

  if (!content || typeof content !== "string") {
    return NextResponse.json({ error: "content is required" }, { status: 400 });
  }

  // Save human message
  const humanResult = await pool.query(
    "INSERT INTO messages (channel_id, sender, sender_type, content) VALUES ($1, $2, $3, $4) RETURNING *",
    [channel_id, sender, "human", content]
  );
  const humanMsg = humanResult.rows[0];
  broadcast({ type: "message", message: humanMsg });

  // All messages route through Drew (the brain)
  const agent = agents.drew;
  broadcast({ type: "typing", agent_id: agent.id, agent_name: agent.name });

  // Get recent messages for context
  const historyResult = await pool.query(
    "SELECT sender, sender_type, content FROM messages WHERE channel_id = $1 ORDER BY created_at DESC LIMIT 20",
    [channel_id]
  );
  const history = historyResult.rows.reverse();

  const messages: Anthropic.MessageParam[] = history.map((m) => ({
    role: m.sender_type === "human" ? ("user" as const) : ("assistant" as const),
    content: m.content,
  }));

  while (messages.length > 0 && messages[0].role !== "user") {
    messages.shift();
  }

  // Build system prompt with project skills
  let systemPrompt = agent.systemPrompt;

  // Fetch active skills for this project
  try {
    const skillsResult = await pool.query(
      "SELECT name, content FROM project_skills WHERE channel_id = $1 AND active = true ORDER BY created_at ASC",
      [channel_id]
    );
    if (skillsResult.rows.length > 0) {
      const skillsContext = skillsResult.rows
        .map((s) => `### Skill: ${s.name}\n${s.content}`)
        .join("\n\n");
      systemPrompt += `\n\n--- Project Skills (${skillsResult.rows.length} active) ---\n${skillsContext}`;
    }
  } catch {
    // project_skills table may not exist yet
  }

  try {
    const llmResponse = await routeToLLM(
      agent.id,
      systemPrompt,
      messages,
      anthropic,
      channel_id
    );

    // Build reasoning with provider info
    const reasoning = llmResponse.reasoning
      ? `[${llmResponse.provider}] ${llmResponse.reasoning}`
      : null;

    // Save agent response
    const agentResult = await pool.query(
      "INSERT INTO messages (channel_id, sender, sender_type, agent_id, content, reasoning) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *",
      [channel_id, agent.name, "agent", agent.id, llmResponse.text, reasoning]
    );
    const agentMsg = agentResult.rows[0];

    // Extract and create tasks from Drew's response
    await extractAndCreateTasks(llmResponse.text, channel_id);

    // Check if response warrants an approval card
    const approval = detectApproval(llmResponse.text, agent.name);
    let approvalData = null;
    if (approval) {
      const approvalResult = await pool.query(
        `INSERT INTO approvals (message_id, channel_id, title, description, requested_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [agentMsg.id, channel_id, approval.title, approval.description, agent.name]
      );
      approvalData = approvalResult.rows[0];
      broadcast({ type: "approval", approval: approvalData });
    }

    broadcast({ type: "stop_typing", agent_id: agent.id });
    broadcast({
      type: "message",
      message: {
        ...agentMsg,
        approval_id: approvalData?.id || null,
        approval_title: approvalData?.title || null,
        approval_description: approvalData?.description || null,
        approval_status: approvalData?.status || null,
      },
    });

    return NextResponse.json(agentMsg);
  } catch (error: unknown) {
    broadcast({ type: "stop_typing", agent_id: agent.id });
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Agent error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
