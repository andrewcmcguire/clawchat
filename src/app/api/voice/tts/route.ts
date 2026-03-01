import { NextRequest } from "next/server";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Map agents to TTS voices
const agentVoices: Record<string, "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer"> = {
  drew: "onyx",
  brian: "echo",
  lisa: "nova",
  vera: "shimmer",
};

export async function POST(req: NextRequest) {
  try {
    const { text, agent_id = "drew" } = await req.json();

    if (!text || typeof text !== "string") {
      return new Response(JSON.stringify({ error: "text is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Truncate to 4096 chars (OpenAI TTS limit)
    const truncatedText = text.slice(0, 4096);

    const voice = agentVoices[agent_id] || "onyx";

    const mp3 = await openai.audio.speech.create({
      model: "tts-1",
      voice,
      input: truncatedText,
    });

    const buffer = Buffer.from(await mp3.arrayBuffer());

    return new Response(buffer, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": buffer.length.toString(),
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "TTS failed";
    console.error("TTS error:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
