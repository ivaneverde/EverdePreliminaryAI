import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseInventoryHtmlXls } from "@/lib/inventoryImport";
import { writeInventoryMetaMap } from "@/lib/inventoryMeta";

/** Large imports can exceed Hobby’s default function limit; Pro allows up to 300s. */
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "Missing file upload." }, { status: 400 });
    }

    const raw = await file.text();
    const parsed = parseInventoryHtmlXls(raw);

    if (parsed.rows.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error: parsed.meta.warning ?? "No inventory rows found.",
          headersFound: parsed.meta.headersFound,
        },
        { status: 400 }
      );
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

    return NextResponse.json({
      ok: true,
      totalParsed: parsed.rows.length,
      created,
      updated,
      headersFound: parsed.meta.headersFound,
      warning: parsed.meta.warning,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message ?? "Failed to import inventory." },
      { status: 500 }
    );
  }
}

