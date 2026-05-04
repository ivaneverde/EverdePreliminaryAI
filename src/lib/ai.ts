import OpenAI from "openai";
import { z } from "zod";
import { getInventoryItem, listInventory } from "./inventory";

const CartAdditionSchema = z.object({
  sku: z.string().min(1),
  quantity: z.number().int().positive(),
});

export type CartAddition = z.infer<typeof CartAdditionSchema>;

const ProposedCartToolInputSchema = z.object({
  additions: z.array(CartAdditionSchema).max(50),
});

type AssistantInventoryItem = Awaited<ReturnType<typeof listInventory>>[number];

export async function runSalesAssistantChat(params: {
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  maxInventoryItemsForContext?: number;
}) {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    throw new Error("Missing OPENAI_API_KEY (see .env.example).");
  }

  const client = new OpenAI({ apiKey: openaiKey });

  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
  const maxInventoryItemsForContext = params.maxInventoryItemsForContext ?? 25;

  const systemPrompt =
    "You are a friendly, knowledgeable plant-friendly sales assistant. " +
    "Help new customers understand products and choose items based on inventory availability. " +
    "Always avoid suggesting items that are out of stock. " +
    "If the user asks for pricing, quality, or availability, only use the provided inventory data. " +
    "Always include the item price when mentioning or recommending a specific inventory item. " +
    "If the user asks for prices for items already mentioned, look them up by SKU or name and answer with prices. " +
    "Never say pricing is unavailable when the inventory data includes priceCents or price. " +
    "When showing plant links, use clean markdown links like [View Plant](https://...). " +
    "Never output a raw URL on a separate line. " +
    "When appropriate, propose specific SKUs with quantities for adding to the cart. " +
    "If the user is unsure, ask short clarifying questions. " +
    "Be warm, concise, and helpful.";

  // Tools: model can query inventory and propose cart additions.
  const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
    {
      type: "function",
      function: {
        name: "search_inventory",
        description: "Search inventory by a keyword and return matching items.",
        parameters: {
          type: "object",
          properties: {
            q: { type: "string", description: "Keyword or partial SKU/name to search for." },
            limit: { type: "integer", description: "Max items to return.", default: 10 },
            availableOnly: { type: "boolean", description: "Return only items with availability > 0.", default: true },
          },
          required: ["q"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_inventory_item",
        description: "Get detailed info about one item by SKU.",
        parameters: {
          type: "object",
          properties: {
            sku: { type: "string", description: "The exact SKU." },
          },
          required: ["sku"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "propose_cart_additions",
        description: "Propose items (SKU + quantity) to add to the cart.",
        parameters: {
          type: "object",
          properties: {
            additions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  sku: { type: "string" },
                  quantity: { type: "integer", minimum: 1 },
                },
                required: ["sku", "quantity"],
              },
            },
          },
          required: ["additions"],
        },
      },
    },
  ];

  const openaiMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...params.messages.map((m) => ({ role: m.role, content: m.content })),
  ];

  // For broad recommendation prompts, preload a compact inventory snapshot so the assistant
  // can respond concretely even if it does not trigger a tool call on the first turn.
  const latestUserMessage = [...params.messages].reverse().find((m) => m.role === "user")?.content ?? "";
  if (shouldPrimeWithInventory(latestUserMessage)) {
    const preloaded = await listInventory({
      availableOnly: true,
      limit: Math.min(maxInventoryItemsForContext, 30),
    });
    openaiMessages.push({
      role: "system",
      content: `Inventory snapshot (in stock): ${JSON.stringify(preloaded.map(formatInventoryItemForAssistant))}`,
    });
  }

  if (isPricingQuestion(latestUserMessage)) {
    const pricingContext = await buildPricingContext(params.messages, maxInventoryItemsForContext);
    if (pricingContext.length > 0) {
      openaiMessages.push({
        role: "system",
        content: `Pricing context from inventory data: ${JSON.stringify(pricingContext)}`,
      });
    }
  }

  const assistantCartAdditions: CartAddition[] = [];

  for (let turn = 0; turn < 4; turn++) {
    const completion = await client.chat.completions.create({
      model,
      messages: openaiMessages,
      tools,
      tool_choice: "auto",
      temperature: 0.2,
    });

    const msg = completion.choices[0]?.message;
    if (!msg) break;

    if (msg.tool_calls && msg.tool_calls.length > 0) {
      // Persist assistant message including tool_calls so subsequent tool messages are valid.
      openaiMessages.push({
        role: "assistant",
        content: msg.content ?? "",
        tool_calls: msg.tool_calls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments,
          },
        })),
      });

      for (const toolCall of msg.tool_calls) {
        const name = toolCall.function.name;
        const argsRaw = toolCall.function.arguments ?? "{}";
        const toolCallId = toolCall.id;

        try {
          if (name === "search_inventory") {
            const args = z
              .object({
                q: z.string().min(1),
                limit: z.number().int().min(1).max(50).optional(),
                availableOnly: z.boolean().optional(),
              })
              .parse(JSON.parse(argsRaw));

            const results = await listInventory({
              q: args.q,
              availableOnly: args.availableOnly ?? true,
              limit: args.limit ?? maxInventoryItemsForContext,
            });

            openaiMessages.push({
              role: "tool",
              tool_call_id: toolCallId,
              content: JSON.stringify({ results: results.map(formatInventoryItemForAssistant) }),
            });
          } else if (name === "get_inventory_item") {
            const args = z.object({ sku: z.string().min(1) }).parse(JSON.parse(argsRaw));
            const item = await getInventoryItem(args.sku);
            openaiMessages.push({
              role: "tool",
              tool_call_id: toolCallId,
              content: JSON.stringify({ item: item ? formatInventoryItemForAssistant(item) : null }),
            });
          } else if (name === "propose_cart_additions") {
            const args = ProposedCartToolInputSchema.parse(JSON.parse(argsRaw));
            assistantCartAdditions.push(...args.additions);
            openaiMessages.push({
              role: "tool",
              tool_call_id: toolCallId,
              content: JSON.stringify({ ok: true, additions: args.additions }),
            });
          } else {
            openaiMessages.push({
              role: "tool",
              tool_call_id: toolCallId,
              content: JSON.stringify({ error: `Unknown tool: ${name}` }),
            });
          }
        } catch (e) {
          openaiMessages.push({
            role: "tool",
            tool_call_id: toolCallId,
            content: JSON.stringify({ error: (e as Error).message ?? "Tool execution failed" }),
          });
        }
      }

      continue;
    }

    const content = (msg.content ?? "").trim();
    if (content) {
      return {
        reply: cleanAssistantReply(content),
        proposedCartAdditions: dedupeCartAdditions(assistantCartAdditions),
      };
    }

    break;
  }

  return {
    reply: cleanAssistantReply(
      "I can help with suggestions, availability, and pricing. Tell me what plant type or SKU you're looking for, and your delivery timeframe.",
    ),
    proposedCartAdditions: dedupeCartAdditions(assistantCartAdditions),
  };
}

function dedupeCartAdditions(additions: CartAddition[]) {
  const bySku = new Map<string, number>();
  for (const a of additions) {
    bySku.set(a.sku, (bySku.get(a.sku) ?? 0) + a.quantity);
  }
  return Array.from(bySku.entries()).map(([sku, quantity]) => ({ sku, quantity }));
}

function shouldPrimeWithInventory(userText: string) {
  const q = userText.toLowerCase();
  return (
    q.includes("suggest") ||
    q.includes("recommend") ||
    q.includes("new customer") ||
    q.includes("what should") ||
    q.includes("best option") ||
    q.includes("low light") ||
    q.includes("inventory")
  );
}

function isPricingQuestion(userText: string) {
  return /\b(price|prices|pricing|cost|costs|how much|\$)\b/i.test(userText);
}

async function buildPricingContext(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  limit: number,
) {
  const recentText = messages
    .slice(-6)
    .map((m) => m.content)
    .join("\n");

  const skuMatches = Array.from(
    recentText.matchAll(/\bSKU\W{0,8}([A-Z0-9][A-Z0-9-]{3,})\b/gi),
    (match) => match[1],
  );
  const uniqueSkus = Array.from(new Set(skuMatches.map((sku) => sku.toUpperCase()))).slice(0, 20);

  const items: AssistantInventoryItem[] = [];
  for (const sku of uniqueSkus) {
    const item = await getInventoryItem(sku);
    if (item && item.availabilityQty > 0) {
      items.push(item);
    }
  }

  if (items.length === 0) {
    const latestPlantLikeLine = messages
      .slice()
      .reverse()
      .flatMap((m) => m.content.split("\n").reverse())
      .map((line) => line.replace(/[*_`#>-]/g, " ").trim())
      .find((line) => line.length > 3 && !/^sku\b/i.test(line) && !/^view plant\b/i.test(line));

    if (latestPlantLikeLine) {
      items.push(
        ...(await listInventory({
          q: latestPlantLikeLine,
          availableOnly: true,
          limit: Math.min(limit, 10),
        })),
      );
    }
  }

  return items.slice(0, limit).map(formatInventoryItemForAssistant);
}

function formatInventoryItemForAssistant(item: AssistantInventoryItem) {
  return {
    ...item,
    price: formatMoneyFromCents(item.priceCents, item.currency),
  };
}

function formatMoneyFromCents(cents: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(cents / 100);
}

function cleanAssistantReply(text: string) {
  const withoutRawUrlLines = text
    .split("\n")
    .filter((line) => !/^\s*\(?https?:\/\/[^\s)]+\)?\s*$/i.test(line))
    .join("\n")
    .trim();

  // Normalize markdown image links to regular links so chat shows clean "View Plant" links.
  return withoutRawUrlLines.replace(/!\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "[$1]($2)");
}

