import { NextResponse } from "next/server";
import { extractInventoryFromAttachment } from "@/lib/inventoryAutomationPayload";
import { parseInventoryForImport, upsertParsedInventory } from "@/lib/inventoryImportService";

/** Large imports can exceed Hobby’s default function limit; Pro allows up to 300s. */
export const maxDuration = 60;

type AutomatedPayload = {
  fileName?: string;
  filename?: string;
  fileContentBase64?: string;
  contentBase64?: string;
};

function env(name: string): string | undefined {
  const v = process.env[name];
  return v != null && v.trim() !== "" ? v.trim() : undefined;
}

function isAuthorized(req: Request): boolean {
  const token = env("INVENTORY_AUTOMATION_TOKEN");
  if (!token) return false;
  const header = req.headers.get("authorization") ?? "";
  return header === `Bearer ${token}`;
}

export async function POST(req: Request) {
  try {
    if (!isAuthorized(req)) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized. Missing or invalid bearer token." },
        { status: 401 }
      );
    }

    const contentType = req.headers.get("content-type") ?? "";
    let fileName = "inventory-report.xls";
    let rawBytes = Buffer.alloc(0);

    if (contentType.includes("application/json")) {
      const body = (await req.json()) as AutomatedPayload;
      const b64 = body.fileContentBase64 ?? body.contentBase64;
      if (!b64 || typeof b64 !== "string") {
        return NextResponse.json(
          { ok: false, error: "Missing base64 attachment content in JSON payload." },
          { status: 400 }
        );
      }
      fileName = body.fileName ?? body.filename ?? fileName;
      rawBytes = Buffer.from(b64, "base64");
    } else {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json({ ok: false, error: "Missing file upload." }, { status: 400 });
      }
      fileName = file.name || fileName;
      rawBytes = Buffer.from(await file.arrayBuffer());
    }

    const extracted = await extractInventoryFromAttachment(fileName, rawBytes);
    if (!extracted) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "No supported inventory attachment found. Provide a direct .xls/.xlsx/.html file or a nested .eml/.msg containing one.",
          fileName,
        },
        { status: 400 }
      );
    }

    const parsed = parseInventoryForImport(extracted.rawText);
    if (parsed.rows.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error: parsed.meta.warning ?? "No inventory rows found.",
          headersFound: parsed.meta.headersFound,
          fileName: extracted.fileName,
        },
        { status: 400 }
      );
    }

    const result = await upsertParsedInventory(extracted.rawText);
    return NextResponse.json({
      ...result,
      automated: true,
      fileName: extracted.fileName,
      source: extracted.source,
      importedAtUtc: new Date().toISOString(),
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message ?? "Automated import failed." },
      { status: 500 }
    );
  }
}
