import { NextResponse } from "next/server";
import { parseInventoryForImport, upsertParsedInventory } from "@/lib/inventoryImportService";

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
    const parsed = parseInventoryForImport(raw);

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
    const result = await upsertParsedInventory(raw);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message ?? "Failed to import inventory." },
      { status: 500 }
    );
  }
}

