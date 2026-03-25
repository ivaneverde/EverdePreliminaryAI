import { NextResponse } from "next/server";
import { z } from "zod";
import { runSalesAssistantChat } from "@/lib/ai";

const IncomingSchema = z.object({
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() })).max(50),
  cart: z.array(z.object({ sku: z.string().min(1), quantity: z.number().int().positive() })).max(100),
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = IncomingSchema.parse(body);

    const cartSummary =
      parsed.cart.length === 0
        ? "The customer's cart is currently empty."
        : `The customer's current cart contains: ${parsed.cart
            .map((c) => `${c.quantity}x ${c.sku}`)
            .join(", ")}. When proposing new items, avoid duplicates if possible.`;

    // Append cart context to the user's most recent message to keep conversation flow natural.
    const messagesForAssistant = [...parsed.messages];
    const last = messagesForAssistant[messagesForAssistant.length - 1];
    if (last?.role === "user") {
      last.content = `${last.content}\n\nCart context: ${cartSummary}`;
    } else {
      messagesForAssistant.push({ role: "user", content: `Cart context: ${cartSummary}` });
    }

    const result = await runSalesAssistantChat({
      messages: messagesForAssistant as Array<{ role: "user" | "assistant"; content: string }>,
    });

    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message ?? "AI chat failed." },
      { status: 400 }
    );
  }
}

