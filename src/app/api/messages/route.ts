import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { auth } from "@/auth";
import { agents } from "@/lib/agents";
import { broadcast } from "@/lib/sse";
import { routeToLLM } from "@/lib/llm-router";
import Anthropic from "@anthropic-ai/sdk";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

// Anthropic client kept for workers and non-Drew routes
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || "not-set" });

const RECENT_MESSAGE_LIMIT = 50;
const SUMMARY_THRESHOLD = 50;

// Code channel system prompt override
const CODE_SYSTEM_PROMPT = `You are Drew, operating in Code Mode for Steadybase.

In this channel, you act as an expert software engineer. Your responses should:
- Be precise and technical
- Include code snippets with proper syntax highlighting (use fenced code blocks with language tags)
- Explain architecture decisions when relevant
- Use terminal-style formatting for commands
- Be concise — skip pleasantries, go straight to the solution

You still have all your capabilities (task creation, delegation, etc.) but your primary focus is code.

Task Creation:
[TASK: title | priority: low/medium/high/urgent | status: backlog/todo/in_progress]`;

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

// Summarize older messages and store as channel memory
async function summarizeAndStore(channelId: string): Promise<string | null> {
  try {
    const countResult = await pool.query(
      "SELECT COUNT(*) as total FROM messages WHERE channel_id = $1",
      [channelId]
    );
    const total = parseInt(countResult.rows[0].total, 10);

    if (total <= SUMMARY_THRESHOLD) return null;

    // Get existing summary
    const channelResult = await pool.query(
      "SELECT memory_summary, summary_updated_at FROM channels WHERE id = $1",
      [channelId]
    );
    const existingSummary = channelResult.rows[0]?.memory_summary;
    const lastSummaryAt = channelResult.rows[0]?.summary_updated_at;

    // Get messages older than the last 50 that haven't been summarized yet
    const olderMessages = await pool.query(
      `SELECT sender, sender_type, content, created_at FROM messages
       WHERE channel_id = $1
       ${lastSummaryAt ? "AND created_at > $2" : ""}
       ORDER BY created_at ASC
       OFFSET 0 LIMIT $${lastSummaryAt ? "3" : "2"}`,
      lastSummaryAt
        ? [channelId, lastSummaryAt, Math.max(0, total - RECENT_MESSAGE_LIMIT)]
        : [channelId, Math.max(0, total - RECENT_MESSAGE_LIMIT)]
    );

    if (olderMessages.rows.length < 10) return existingSummary; // Not enough new messages to warrant re-summarizing

    // Build conversation text for summarization
    const conversationText = olderMessages.rows
      .map((m) => `${m.sender} (${m.sender_type}): ${m.content.substring(0, 500)}`)
      .join("\n");

    const summaryPrompt = existingSummary
      ? `Here is the previous conversation summary:\n${existingSummary}\n\nHere are new messages since then:\n${conversationText}\n\nUpdate the summary to include the new information. Keep it concise (max 500 words). Focus on key decisions, action items, important context, and user preferences.`
      : `Summarize this conversation for future context. Keep it concise (max 500 words). Focus on key decisions, action items, important context, and user preferences.\n\n${conversationText}`;

    // Use CLI for summarization (same as Drew — no API key needed)
    let summary = "";
    try {
      const { stdout } = await execFileAsync("claude", [
        "-p", summaryPrompt,
        "--system-prompt", "You are a conversation summarizer. Create concise, factual summaries that preserve important context, decisions, and action items.",
        "--output-format", "json",
        "--model", "sonnet",
      ], { timeout: 30000, maxBuffer: 1024 * 1024 });

      const result = JSON.parse(stdout);
      summary = result.result || result.text || stdout;
    } catch {
      // Backup-backup: try Anthropic API if CLI fails
      const summaryResponse = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 1000,
        system: "You are a conversation summarizer. Create concise, factual summaries that preserve important context, decisions, and action items.",
        messages: [{ role: "user", content: summaryPrompt }],
      });
      for (const block of summaryResponse.content) {
        if (block.type === "text") summary = block.text;
      }
    }

    if (summary) {
      await pool.query(
        "UPDATE channels SET memory_summary = $1, summary_updated_at = NOW() WHERE id = $2",
        [summary, channelId]
      );
      return summary;
    }

    return existingSummary;
  } catch (err) {
    console.error("Summarization failed:", err);
    return null;
  }
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
  const session = await auth();
  const body = await req.json();
  const { content, channel_id = "general" } = body;
  const sender = session?.user?.name || "You";

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

  // Check channel type for code channel routing
  let channelType = "project";
  try {
    const channelResult = await pool.query(
      "SELECT project_type FROM channels WHERE id = $1",
      [channel_id]
    );
    if (channelResult.rows[0]?.project_type) {
      channelType = channelResult.rows[0].project_type;
    }
  } catch { /* channel may not exist */ }

  // Get conversation memory summary
  let memorySummary: string | null = null;
  try {
    const summaryResult = await pool.query(
      "SELECT memory_summary FROM channels WHERE id = $1",
      [channel_id]
    );
    memorySummary = summaryResult.rows[0]?.memory_summary || null;
  } catch { /* summary column may not exist yet */ }

  // Get recent messages for context (last 50 instead of 20)
  const historyResult = await pool.query(
    "SELECT sender, sender_type, content FROM messages WHERE channel_id = $1 ORDER BY created_at DESC LIMIT $2",
    [channel_id, RECENT_MESSAGE_LIMIT]
  );
  const history = historyResult.rows.reverse();

  const messages: Anthropic.MessageParam[] = history.map((m) => ({
    role: m.sender_type === "human" ? ("user" as const) : ("assistant" as const),
    content: m.content,
  }));

  while (messages.length > 0 && messages[0].role !== "user") {
    messages.shift();
  }

  // Build system prompt
  let systemPrompt = channelType === "code" ? CODE_SYSTEM_PROMPT : agent.systemPrompt;

  // Add memory summary context
  if (memorySummary) {
    systemPrompt += `\n\n--- Conversation Memory ---\nThe following is a summary of earlier conversation in this channel that you should reference for context:\n${memorySummary}`;
  }

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

    // Trigger background summarization if message count is high
    // (fire and forget — don't block the response)
    summarizeAndStore(channel_id).catch((err) =>
      console.error("Background summarization error:", err)
    );

    return NextResponse.json(agentMsg);
  } catch (error: unknown) {
    broadcast({ type: "stop_typing", agent_id: agent.id });
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Agent error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
