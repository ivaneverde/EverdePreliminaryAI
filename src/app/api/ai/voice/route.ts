import { NextResponse } from "next/server";
import OpenAI from "openai";
import { z } from "zod";

export const maxDuration = 30;

const VoiceRequestSchema = z.object({
  text: z.string().trim().min(1).max(3500),
});

function env(name: string): string | undefined {
  const v = process.env[name];
  return v != null && v.trim() !== "" ? v.trim() : undefined;
}

export async function POST(req: Request) {
  try {
    const openaiKey = env("OPENAI_VOICE_API_KEY") ?? env("OPENAI_API_KEY");
    if (!openaiKey) {
      return NextResponse.json(
        { error: "Missing OPENAI_VOICE_API_KEY or OPENAI_API_KEY." },
        { status: 500 }
      );
    }

    const body = await req.json();
    const parsed = VoiceRequestSchema.parse(body);

    const client = new OpenAI({ apiKey: openaiKey });
    const model = env("OPENAI_TTS_MODEL") ?? "tts-1-hd";
    const voice = env("OPENAI_TTS_VOICE") ?? "nova";

    const speech = await client.audio.speech.create({
      model,
      voice,
      input: parsed.text,
      response_format: "mp3",
      speed: 0.95,
    });

    const audio = Buffer.from(await speech.arrayBuffer());
    return new NextResponse(audio, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message ?? "Voice generation failed." },
      { status: 400 }
    );
  }
}
