import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseInventoryHtmlXls } from "@/lib/inventoryImport";
import { writeInventoryMetaMap } from "@/lib/inventoryMeta";

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

    await prisma.$transaction(async (tx) => {
      for (const row of parsed.rows) {
        metadataMap[row.sku] = {
          viewPlantUrl: row.viewPlantUrl ?? undefined,
          farmCode: row.farmCode ?? undefined,
        };
        const existing = await tx.inventoryItem.findUnique({ where: { sku: row.sku }, select: { sku: true } });
        if (existing) {
          updated += 1;
          await tx.inventoryItem.update({
            where: { sku: row.sku },
            data: {
              name: row.name,
              quality: row.quality,
              availabilityQty: row.availabilityQty,
              priceCents: row.priceCents,
              currency: row.currency,
            },
          });
        } else {
          created += 1;
          await tx.inventoryItem.create({
            data: {
              sku: row.sku,
              name: row.name,
              quality: row.quality,
              availabilityQty: row.availabilityQty,
              priceCents: row.priceCents,
              currency: row.currency,
            },
          });
        }
      }
    });
    await writeInventoryMetaMap(metadataMap);

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

