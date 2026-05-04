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

/** `gpt-4o-mini-tts` supports `instructions`; `tts-1` / `tts-1-hd` use `speed` instead (per SDK types). */
function isLegacyTtsModel(model: string) {
  return model === "tts-1" || model === "tts-1-hd";
}

const DEFAULT_TTS_INSTRUCTIONS =
  "You sound like a warm American woman in her mid-twenties who works at a plant nursery and loves helping people. " +
  "Friendly, a little playful, genuinely engaged—like you are chatting with a friend at the shop, not reading a script. " +
  "Speak slightly faster than everyday conversation—smooth and fluid, with natural run-on phrasing and light intonation. " +
  "Avoid choppy delivery, long awkward pauses, or over-enunciating each word; keep clauses flowing together. " +
  "Light smiles in your tone, never stiff, slow, matronly, or corporate. Do not sound older than your twenties.";

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
    const model = env("OPENAI_TTS_MODEL") ?? "gpt-4o-mini-tts";
    const voice = env("OPENAI_TTS_VOICE") ?? "nova";
    const legacy = isLegacyTtsModel(model);
    const speedRaw = env("OPENAI_TTS_SPEED");
    const speed = speedRaw != null ? Number(speedRaw) : 1.18;
    const instructions = env("OPENAI_TTS_INSTRUCTIONS") ?? DEFAULT_TTS_INSTRUCTIONS;

    const speech = await client.audio.speech.create({
      model,
      voice,
      input: parsed.text,
      response_format: "mp3",
      ...(legacy
        ? { speed: Number.isFinite(speed) ? Math.min(4, Math.max(0.25, speed)) : 1.18 }
        : { instructions }),
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
