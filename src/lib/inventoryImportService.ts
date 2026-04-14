import { prisma } from "./prisma";
import { parseInventoryHtmlXls } from "./inventoryImport";
import { writeInventoryMetaMap } from "./inventoryMeta";

export type InventoryImportResult = {
  ok: true;
  totalParsed: number;
  created: number;
  updated: number;
  headersFound: string[];
  warning: string | null;
};

export function parseInventoryForImport(raw: string) {
  return parseInventoryHtmlXls(raw);
}

export async function upsertParsedInventory(raw: string): Promise<InventoryImportResult> {
  const parsed = parseInventoryForImport(raw);

  if (parsed.rows.length === 0) {
    throw new Error(parsed.meta.warning ?? "No inventory rows found.");
  }

  let created = 0;
  let updated = 0;
  const metadataMap: Record<string, { viewPlantUrl?: string; farmCode?: string }> = {};

  const skus = parsed.rows.map((r) => r.sku);
  const alreadyInDb = await prisma.inventoryItem.findMany({
    where: { sku: { in: skus } },
    select: { sku: true },
  });
  const existingSku = new Set(alreadyInDb.map((r) => r.sku));

  // One upsert per row (no long interactive $transaction), so Vercel/Neon don't drop the txn.
  for (const row of parsed.rows) {
    metadataMap[row.sku] = {
      viewPlantUrl: row.viewPlantUrl ?? undefined,
      farmCode: row.farmCode ?? undefined,
    };
    if (existingSku.has(row.sku)) updated += 1;
    else {
      created += 1;
      existingSku.add(row.sku);
    }
    await prisma.inventoryItem.upsert({
      where: { sku: row.sku },
      create: {
        sku: row.sku,
        name: row.name,
        quality: row.quality,
        viewPlantUrl: row.viewPlantUrl,
        farmCode: row.farmCode,
        availabilityQty: row.availabilityQty,
        priceCents: row.priceCents,
        currency: row.currency,
      },
      update: {
        name: row.name,
        quality: row.quality,
        viewPlantUrl: row.viewPlantUrl,
        farmCode: row.farmCode,
        availabilityQty: row.availabilityQty,
        priceCents: row.priceCents,
        currency: row.currency,
      },
    });
  }

  try {
    await writeInventoryMetaMap(metadataMap);
  } catch {
    // Ephemeral/read-only FS on serverless (e.g. Vercel); DB row already has viewPlantUrl + farmCode.
  }

  return {
    ok: true,
    totalParsed: parsed.rows.length,
    created,
    updated,
    headersFound: parsed.meta.headersFound,
    warning: parsed.meta.warning,
  };
}
