import { NextResponse } from "next/server";
import { getInventoryItem, InventoryListQuerySchema, listInventory } from "@/lib/inventory";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const sku = url.searchParams.get("sku");
    if (sku) {
      const item = await getInventoryItem(sku);
      return NextResponse.json({ item });
    }

    const query = {
      q: url.searchParams.get("q") ?? undefined,
      availableOnly: url.searchParams.get("availableOnly") ?? undefined,
      filter: url.searchParams.get("filter") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
      offset: url.searchParams.get("offset") ?? undefined,
    };

    const parsed = InventoryListQuerySchema.parse(query);
    const items = await listInventory(parsed);
    return NextResponse.json({ items });
  } catch (e) {
    console.error("GET /api/inventory", e);
    return NextResponse.json(
      { error: (e as Error).message ?? "Inventory request failed", items: [] },
      { status: 500 }
    );
  }
}
