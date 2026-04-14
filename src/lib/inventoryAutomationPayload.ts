import { simpleParser } from "mailparser";

type ExtractedInventory = {
  fileName: string;
  rawText: string;
  source: "direct" | "eml" | "msg";
};

const INVENTORY_FILE_RE = /\.(xls|xlsx|html?|htm)$/i;
const NESTED_MAIL_RE = /\.(eml|msg)$/i;

function looksLikeInventoryHtml(text: string): boolean {
  const t = text.toLowerCase();
  return t.includes("<table") && t.includes("saleable qty") && t.includes("price");
}

function normalizeFileName(fileName: string | undefined, fallback: string): string {
  const n = (fileName ?? "").trim();
  return n.length > 0 ? n : fallback;
}

async function extractFromEml(raw: Buffer, depth: number): Promise<ExtractedInventory | null> {
  if (depth > 3) return null;
  const parsed = await simpleParser(raw);
  for (const a of parsed.attachments) {
    const name = normalizeFileName(a.filename ?? undefined, "attachment.bin");
    const found = await extractInventoryFromAttachment(name, Buffer.from(a.content), depth + 1);
    if (found) return found;
  }
  return null;
}

async function extractFromMsg(raw: Buffer, depth: number): Promise<ExtractedInventory | null> {
  if (depth > 3) return null;
  // msgreader is CommonJS and has no TS typings; require keeps type-safety local.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const MsgReader = require("msgreader");
  const reader = new MsgReader(raw);
  const fileData = reader.getFileData();
  const attachments = Array.isArray(fileData?.attachments) ? fileData.attachments : [];
  for (const att of attachments) {
    const extracted = reader.getAttachment(att);
    const name = normalizeFileName(extracted?.fileName, "attachment.bin");
    const content = extracted?.content;
    if (!content) continue;
    const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
    const found = await extractInventoryFromAttachment(name, bytes, depth + 1);
    if (found) return found;
  }
  return null;
}

export async function extractInventoryFromAttachment(
  fileName: string,
  raw: Buffer,
  depth = 0
): Promise<ExtractedInventory | null> {
  const lowerName = fileName.toLowerCase();

  if (INVENTORY_FILE_RE.test(lowerName)) {
    const text = raw.toString("utf-8");
    if (looksLikeInventoryHtml(text)) {
      return { fileName, rawText: text, source: depth === 0 ? "direct" : "eml" };
    }
    // Most Oracle ".xls" exports are HTML text. Keep permissive if extension matches.
    return { fileName, rawText: text, source: depth === 0 ? "direct" : "eml" };
  }

  if (NESTED_MAIL_RE.test(lowerName)) {
    if (lowerName.endsWith(".eml")) {
      const extracted = await extractFromEml(raw, depth);
      if (extracted) return { ...extracted, source: "eml" };
      return null;
    }
    if (lowerName.endsWith(".msg")) {
      const extracted = await extractFromMsg(raw, depth);
      if (extracted) return { ...extracted, source: "msg" };
      return null;
    }
  }

  // Some providers may omit extension; fallback to HTML signature.
  const text = raw.toString("utf-8");
  if (looksLikeInventoryHtml(text)) {
    return { fileName, rawText: text, source: depth === 0 ? "direct" : "eml" };
  }

  return null;
}
