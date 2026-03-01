import { NextRequest, NextResponse } from "next/server";
import { callProvider, type LLMProvider } from "@/lib/llm-router";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: NextRequest) {
  try {
    const { systemPrompt, userMessage, providerA, providerB } = await req.json();

    if (!userMessage || typeof userMessage !== "string") {
      return NextResponse.json({ error: "userMessage is required" }, { status: 400 });
    }

    const system = systemPrompt || "You are a helpful assistant.";
    const messages: Anthropic.MessageParam[] = [{ role: "user", content: userMessage }];
    const pA: LLMProvider = providerA || "claude-opus";
    const pB: LLMProvider = providerB || "claude-sonnet";

    const costs: Record<string, { input: number; output: number }> = {
      "claude-opus": { input: 15, output: 75 },
      "claude-sonnet": { input: 3, output: 15 },
      lmstudio: { input: 0, output: 0 },
      google: { input: 0.075, output: 0.3 },
      openai: { input: 2.5, output: 10 },
    };

    // Run both providers in parallel
    const [resultA, resultB] = await Promise.allSettled([
      (async () => {
        const start = Date.now();
        const r = await callProvider(pA, system, messages, anthropic);
        const latency = Date.now() - start;
        const inputTokens = Math.ceil((system.length + userMessage.length) / 4);
        const outputTokens = Math.ceil(r.text.length / 4);
        const rate = costs[pA] || costs["claude-sonnet"];
        const cost = (inputTokens * rate.input + outputTokens * rate.output) / 1000000;
        return { text: r.text, provider: r.provider, latency, inputTokens, outputTokens, cost: cost.toFixed(4) };
      })(),
      (async () => {
        const start = Date.now();
        const r = await callProvider(pB, system, messages, anthropic);
        const latency = Date.now() - start;
        const inputTokens = Math.ceil((system.length + userMessage.length) / 4);
        const outputTokens = Math.ceil(r.text.length / 4);
        const rate = costs[pB] || costs["claude-sonnet"];
        const cost = (inputTokens * rate.input + outputTokens * rate.output) / 1000000;
        return { text: r.text, provider: r.provider, latency, inputTokens, outputTokens, cost: cost.toFixed(4) };
      })(),
    ]);

    return NextResponse.json({
      a: resultA.status === "fulfilled" ? resultA.value : { error: (resultA as PromiseRejectedResult).reason?.message || "Failed" },
      b: resultB.status === "fulfilled" ? resultB.value : { error: (resultB as PromiseRejectedResult).reason?.message || "Failed" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Lab compare error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
