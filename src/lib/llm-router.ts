import Anthropic from "@anthropic-ai/sdk";
import pool from "@/lib/db";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

// Defaults from env — can be overridden by settings
const DEFAULT_LM_STUDIO_URL = process.env.LM_STUDIO_URL || "http://localhost:1234/v1";
const LM_STUDIO_TIMEOUT = parseInt(process.env.LM_STUDIO_TIMEOUT || "15000", 10);

export type LLMProvider = "claude-cli" | "claude-opus" | "claude-sonnet" | "lmstudio" | "google" | "openai";

export interface LLMResponse {
  text: string;
  reasoning: string;
  provider: LLMProvider;
}

interface ProviderConfig {
  lm_studio_url?: string;
  google_api_key?: string;
  google_model?: string;
  openai_api_key?: string;
  openai_model?: string;
  default_worker_provider?: LLMProvider;
}

// Load settings from DB for a project (merged with global)
async function loadProviderConfig(projectId?: string): Promise<ProviderConfig> {
  const config: ProviderConfig = {};

  try {
    // Global settings
    const globalResult = await pool.query(
      "SELECT key, value FROM settings WHERE scope = 'global' AND scope_id IS NULL"
    );
    for (const row of globalResult.rows) {
      (config as Record<string, string>)[row.key] = row.value;
    }

    // Project overrides
    if (projectId) {
      const projResult = await pool.query(
        "SELECT key, value FROM settings WHERE scope = 'project' AND scope_id = $1",
        [projectId]
      );
      for (const row of projResult.rows) {
        (config as Record<string, string>)[row.key] = row.value;
      }
    }
  } catch {
    // settings table may not exist yet
  }

  return config;
}

// Drew (brain) → Opus with extended thinking
// Workers → configurable: LM Studio → fallback provider (Sonnet/Google/OpenAI)
export async function routeToLLM(
  agentId: string,
  systemPrompt: string,
  messages: Anthropic.MessageParam[],
  anthropic: Anthropic,
  projectId?: string
): Promise<LLMResponse> {
  const config = await loadProviderConfig(projectId);

  if (agentId === "drew") {
    // Use Claude CLI with OAuth — no API key needed
    return callClaudeCLI(systemPrompt, messages);
  }

  // Workers: try LM Studio first
  const lmUrl = config.lm_studio_url || DEFAULT_LM_STUDIO_URL;
  try {
    return await callLMStudio(systemPrompt, messages, lmUrl);
  } catch {
    // Fall back to configured worker provider
    const fallback = config.default_worker_provider || "claude-sonnet";

    if (fallback === "google" && config.google_api_key) {
      return callGoogle(systemPrompt, messages, config.google_api_key, config.google_model);
    }
    if (fallback === "openai" && config.openai_api_key) {
      return callOpenAI(systemPrompt, messages, config.openai_api_key, config.openai_model);
    }
    return callClaudeSonnet(systemPrompt, messages, anthropic);
  }
}

// Provider for a specific skill-required LLM
export async function callProvider(
  provider: LLMProvider,
  systemPrompt: string,
  messages: Anthropic.MessageParam[],
  anthropic: Anthropic,
  projectId?: string
): Promise<LLMResponse> {
  const config = await loadProviderConfig(projectId);

  switch (provider) {
    case "claude-cli":
      return callClaudeCLI(systemPrompt, messages);
    case "claude-opus":
      return callClaudeOpus(systemPrompt, messages, anthropic);
    case "claude-sonnet":
      return callClaudeSonnet(systemPrompt, messages, anthropic);
    case "lmstudio":
      return callLMStudio(systemPrompt, messages, config.lm_studio_url || DEFAULT_LM_STUDIO_URL);
    case "google":
      if (!config.google_api_key) throw new Error("Google API key not configured");
      return callGoogle(systemPrompt, messages, config.google_api_key, config.google_model);
    case "openai":
      if (!config.openai_api_key) throw new Error("OpenAI API key not configured");
      return callOpenAI(systemPrompt, messages, config.openai_api_key, config.openai_model);
    default:
      return callClaudeSonnet(systemPrompt, messages, anthropic);
  }
}

async function callLMStudio(
  systemPrompt: string,
  messages: Anthropic.MessageParam[],
  url: string
): Promise<LLMResponse> {
  const lmMessages = [
    { role: "system", content: systemPrompt },
    ...messages.map((m) => ({
      role: m.role,
      content: typeof m.content === "string" ? m.content : "",
    })),
  ];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LM_STUDIO_TIMEOUT);

  try {
    const res = await fetch(`${url}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: lmMessages,
        temperature: 0.7,
        max_tokens: 2048,
      }),
      signal: controller.signal,
    });

    if (!res.ok) throw new Error(`LM Studio returned ${res.status}`);

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || "";

    return { text, reasoning: `Routed to LM Studio (${url})`, provider: "lmstudio" };
  } finally {
    clearTimeout(timeout);
  }
}

async function callClaudeOpus(
  systemPrompt: string,
  messages: Anthropic.MessageParam[],
  anthropic: Anthropic
): Promise<LLMResponse> {
  const response = await anthropic.messages.create({
    model: "claude-opus-4-6",
    max_tokens: 16000,
    temperature: 1,
    thinking: { type: "enabled", budget_tokens: 5000 },
    system: systemPrompt,
    messages,
  });

  let text = "";
  let reasoning = "";
  for (const block of response.content) {
    if (block.type === "thinking") reasoning = block.thinking;
    else if (block.type === "text") text = block.text;
  }

  return { text, reasoning, provider: "claude-opus" };
}

async function callClaudeSonnet(
  systemPrompt: string,
  messages: Anthropic.MessageParam[],
  anthropic: Anthropic
): Promise<LLMResponse> {
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 8000,
    system: systemPrompt,
    messages,
  });

  let text = "";
  for (const block of response.content) {
    if (block.type === "text") text = block.text;
  }

  return { text, reasoning: "", provider: "claude-sonnet" };
}

async function callGoogle(
  systemPrompt: string,
  messages: Anthropic.MessageParam[],
  apiKey: string,
  model?: string
): Promise<LLMResponse> {
  const googleModel = model || "gemini-2.0-flash";

  const contents = messages.map((m) => ({
    role: m.role === "user" ? "user" : "model",
    parts: [{ text: typeof m.content === "string" ? m.content : "" }],
  }));

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${googleModel}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents,
        generationConfig: { maxOutputTokens: 8000, temperature: 0.7 },
      }),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Google API error: ${res.status} ${err}`);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

  return { text, reasoning: "", provider: "google" };
}

// Claude CLI — uses OAuth (user's Claude account), no API key
async function callClaudeCLI(
  systemPrompt: string,
  messages: Anthropic.MessageParam[]
): Promise<LLMResponse> {
  // Build the full prompt with conversation history
  const historyLines: string[] = [];
  for (const msg of messages) {
    const role = msg.role === "user" ? "User" : "Drew";
    const text = typeof msg.content === "string" ? msg.content : "";
    historyLines.push(`${role}: ${text}`);
  }

  // The last message is the current user message
  // Format: system prompt + history context for Claude CLI
  const fullPrompt = historyLines.length > 1
    ? `Previous conversation:\n${historyLines.slice(0, -1).join("\n")}\n\nCurrent message:\n${historyLines[historyLines.length - 1]}`
    : historyLines[historyLines.length - 1] || "";

  try {
    const { stdout } = await execFileAsync("claude", [
      "-p", fullPrompt,
      "--system-prompt", systemPrompt,
      "--output-format", "json",
      "--model", "opus",
    ], {
      timeout: 120_000, // 2 minute timeout
      maxBuffer: 10 * 1024 * 1024, // 10MB
      env: {
        ...process.env,
        CLAUDECODE: undefined, // Allow nested CLI calls
      },
    });

    const result = JSON.parse(stdout);

    if (result.is_error) {
      throw new Error(result.result || "Claude CLI returned an error");
    }

    return {
      text: result.result || "",
      reasoning: `[Claude CLI] Cost: $${result.cost_usd?.toFixed(4) || "0"} | ${result.duration_ms || 0}ms`,
      provider: "claude-cli",
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[Claude CLI] Error:", message);

    // Fallback to API if CLI fails
    console.log("[Claude CLI] Falling back to Anthropic API...");
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    return callClaudeOpus(systemPrompt, messages, anthropic);
  }
}

async function callOpenAI(
  systemPrompt: string,
  messages: Anthropic.MessageParam[],
  apiKey: string,
  model?: string
): Promise<LLMResponse> {
  const openaiModel = model || "gpt-4o";

  const openaiMessages = [
    { role: "system", content: systemPrompt },
    ...messages.map((m) => ({
      role: m.role,
      content: typeof m.content === "string" ? m.content : "",
    })),
  ];

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: openaiModel,
      messages: openaiMessages,
      max_tokens: 8000,
      temperature: 0.7,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI API error: ${res.status} ${err}`);
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || "";

  return { text, reasoning: "", provider: "openai" };
}
