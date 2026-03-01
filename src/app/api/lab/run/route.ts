import { NextRequest, NextResponse } from "next/server";
import { callProvider, type LLMProvider } from "@/lib/llm-router";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: NextRequest) {
  try {
    const { systemPrompt, userMessage, provider } = await req.json();

    if (!userMessage || typeof userMessage !== "string") {
      return NextResponse.json({ error: "userMessage is required" }, { status: 400 });
    }

    const selectedProvider: LLMProvider = provider || "claude-opus";
    const system = systemPrompt || "You are a helpful assistant.";
    const messages: Anthropic.MessageParam[] = [{ role: "user", content: userMessage }];

    const start = Date.now();
    const result = await callProvider(selectedProvider, system, messages, anthropic);
    const latency = Date.now() - start;

    // Rough token estimation (actual tokens would come from API response)
    const inputTokens = Math.ceil((system.length + userMessage.length) / 4);
    const outputTokens = Math.ceil(result.text.length / 4);

    // Cost estimation per provider
    const costs: Record<string, { input: number; output: number }> = {
      "claude-opus": { input: 15, output: 75 },
      "claude-sonnet": { input: 3, output: 15 },
      lmstudio: { input: 0, output: 0 },
      google: { input: 0.075, output: 0.3 },
      openai: { input: 2.5, output: 10 },
    };
    const rate = costs[selectedProvider] || costs["claude-sonnet"];
    const cost = (inputTokens * rate.input + outputTokens * rate.output) / 1000000;

    return NextResponse.json({
      text: result.text,
      provider: result.provider,
      latency,
      inputTokens,
      outputTokens,
      cost: cost.toFixed(4),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Lab run error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
