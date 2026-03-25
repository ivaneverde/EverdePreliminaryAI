import { z } from "zod";
import { prisma } from "./prisma";
import { readInventoryMetaMap } from "./inventoryMeta";

const WEST_FARMS = new Set(["STE", "FOR", "FAL", "WIN", "BRA"]);
const CENTRAL_FARMS = new Set(["GFL", "FOR", "MCR", "STE"]);
const EAST_FARMS = new Set(["GFL", "OAS", "BNL", "MCR"]);

export const InventoryListQuerySchema = z.object({
  q: z.string().optional(),
  availableOnly: z.coerce.boolean().optional(),
  filter: z.enum(["all", "available", "west", "central", "east"]).optional(),
  limit: z.coerce.number().min(1).max(5000).optional(),
});

export type InventoryListQuery = z.infer<typeof InventoryListQuerySchema>;

export async function listInventory(query: InventoryListQuery) {
  const parsed = InventoryListQuerySchema.parse(query);

  const where: Record<string, unknown> = {};
  const q = parsed.q?.trim();

  if (q) {
    where.OR = [
      { sku: { contains: q } },
      { name: { contains: q } },
      { quality: q ? { contains: q } : undefined },
    ].filter(Boolean);
  }

  const limit = parsed.limit ?? 5000;
  const filterMode = parsed.filter ?? (parsed.availableOnly ? "available" : "all");

  const items = await prisma.inventoryItem.findMany({
    where,
    orderBy: [{ availabilityQty: "desc" }, { priceCents: "asc" }],
    select: {
      sku: true,
      name: true,
      quality: true,
      availabilityQty: true,
      priceCents: true,
      currency: true,
    },
  });

  const metadata = await readInventoryMetaMap();
  const withMeta = items.map((item) => ({
    ...item,
    viewPlantUrl: metadata[item.sku]?.viewPlantUrl ?? null,
    farmCode: metadata[item.sku]?.farmCode ?? null,
  }));

  const filtered = withMeta.filter((item) => {
    if (filterMode === "all") return true;
    if (filterMode === "available") return item.availabilityQty > 0;
    if (filterMode === "west") return item.availabilityQty > 0 && WEST_FARMS.has(item.farmCode ?? "");
    if (filterMode === "central") return item.availabilityQty > 0 && CENTRAL_FARMS.has(item.farmCode ?? "");
    if (filterMode === "east") return item.availabilityQty > 0 && EAST_FARMS.has(item.farmCode ?? "");
    return true;
  });

  return filtered.slice(0, limit);
}

export async function getInventoryItem(sku: string) {
  const item = await prisma.inventoryItem.findUnique({
    where: { sku },
    select: {
      sku: true,
      name: true,
      quality: true,
      availabilityQty: true,
      priceCents: true,
      currency: true,
    },
  });
  if (!item) return null;
  const metadata = await readInventoryMetaMap();
  return {
    ...item,
    viewPlantUrl: metadata[item.sku]?.viewPlantUrl ?? null,
    farmCode: metadata[item.sku]?.farmCode ?? null,
  };
}

