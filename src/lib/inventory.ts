import type { Prisma } from "@prisma/client";
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
  offset: z.coerce.number().min(0).max(100_000).optional(),
});

export type InventoryListQuery = z.infer<typeof InventoryListQuerySchema>;

export async function listInventory(query: InventoryListQuery) {
  const parsed = InventoryListQuerySchema.parse(query);

  const where: Prisma.InventoryItemWhereInput = {};
  const q = parsed.q?.trim();

  // PostgreSQL: default `contains` is case-sensitive (unlike typical SQLite feel). Match local UX.
  if (q) {
    where.OR = [
      { sku: { contains: q, mode: "insensitive" } },
      { name: { contains: q, mode: "insensitive" } },
      { quality: { contains: q, mode: "insensitive" } },
    ];
  }

  const limit = parsed.limit ?? 5000;
  const offset = parsed.offset ?? 0;
  const filterMode = parsed.filter ?? (parsed.availableOnly ? "available" : "all");

  // Push filters into SQL so we can use skip/take — avoids loading huge tables into one giant JSON
  // (Vercel/serverless response limits and memory).
  if (filterMode === "available") {
    where.availabilityQty = { gt: 0 };
  } else if (filterMode === "west") {
    where.availabilityQty = { gt: 0 };
    where.farmCode = { in: Array.from(WEST_FARMS) };
  } else if (filterMode === "central") {
    where.availabilityQty = { gt: 0 };
    where.farmCode = { in: Array.from(CENTRAL_FARMS) };
  } else if (filterMode === "east") {
    where.availabilityQty = { gt: 0 };
    where.farmCode = { in: Array.from(EAST_FARMS) };
  }

  const items = await prisma.inventoryItem.findMany({
    where,
    orderBy: [{ availabilityQty: "desc" }, { priceCents: "asc" }],
    skip: offset,
    take: limit,
    select: {
      sku: true,
      name: true,
      quality: true,
      viewPlantUrl: true,
      farmCode: true,
      availabilityQty: true,
      priceCents: true,
      currency: true,
    },
  });

  const metadata = await readInventoryMetaMap();
  return items.map((item) => ({
    ...item,
    viewPlantUrl: item.viewPlantUrl ?? metadata[item.sku]?.viewPlantUrl ?? null,
    farmCode: item.farmCode ?? metadata[item.sku]?.farmCode ?? null,
  }));
}

export async function getInventoryItem(sku: string) {
  const item = await prisma.inventoryItem.findUnique({
    where: { sku },
    select: {
      sku: true,
      name: true,
      quality: true,
      viewPlantUrl: true,
      farmCode: true,
      availabilityQty: true,
      priceCents: true,
      currency: true,
    },
  });
  if (!item) return null;
  const metadata = await readInventoryMetaMap();
  return {
    ...item,
    viewPlantUrl: item.viewPlantUrl ?? metadata[item.sku]?.viewPlantUrl ?? null,
    farmCode: item.farmCode ?? metadata[item.sku]?.farmCode ?? null,
  };
}

