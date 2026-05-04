import { NextResponse } from "next/server";
import { parseInventoryForImport, upsertParsedInventory } from "@/lib/inventoryImportService";
import { timingSafeEqual } from "crypto";

/** Large imports can exceed Hobby’s default function limit; Pro allows up to 300s. */
export const maxDuration = 60;

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

function equalsSecret(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

function isAuthorized(req: Request): boolean {
  const configured = env("INVENTORY_IMPORT_PASSWORD");
  if (!configured) return false;
  const provided = req.headers.get("x-inventory-import-password")?.trim();
  if (!provided) return false;
  return equalsSecret(provided, configured);
}

export async function POST(req: Request) {
  try {
    if (!isAuthorized(req)) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized inventory import request." },
        { status: 401 }
      );
    }

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

