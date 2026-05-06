import * as cheerio from "cheerio";
import type { Element } from "domhandler";

export type ImportedInventoryRow = {
  sku: string;
  name: string;
  quality: string | null;
  viewPlantUrl: string | null;
  farmCode: string | null;
  availabilityQty: number;
  priceCents: number;
  currency: string;
};

const REQUIRED_HEADERS = ["PRICE"];
const QTY_HEADERS = ["SALEABLE QTY", "SALEABLE QTY BY GRADE"];

export function parseInventoryHtmlXls(content: string) {
  const $ = cheerio.load(content);
  const tables = $("table").toArray();

  const allParsedRows: ImportedInventoryRow[] = [];
  let headersFound: string[] = [];
  let matchedTableCount = 0;
  let primaryIndex: Record<string, number> | null = null;

  for (const table of tables) {
    const rows = $(table).find("tr").toArray();
    if (rows.length < 2) continue;

    const headerCells = $(rows[0])
      .find("td,th")
      .toArray()
      .map((cell) => normalizeHeader($(cell).text()));

    if (!containsRequiredHeaders(headerCells)) continue;

    const index = makeHeaderIndex(headerCells);
    if (!primaryIndex) primaryIndex = index;
    headersFound = headerCells;
    matchedTableCount += 1;
    const tableRows = extractRows($, rows.slice(1), index);
    allParsedRows.push(...tableRows);
  }

  // De-duplicate globally by SKU and keep the last row in the file.
  let deduped = dedupeBySku(allParsedRows);

  // Oracle BI Publisher exports can place row data in repeated classed rows
  // outside the table segment that includes headers. Use a fallback sweep.
  if (deduped.length <= 1 && primaryIndex) {
    const fallbackRows = extractRowsFromGlobalClasses($, primaryIndex);
    if (fallbackRows.length > deduped.length) {
      deduped = dedupeBySku(fallbackRows);
    }
  }

  if (deduped.length === 0) {
    return {
      rows: [],
      meta: {
        headersFound,
        matchedTableCount,
        warning:
          "No importable inventory rows found. Ensure this file contains columns such as SKU/ITEM, SALEABLE QTY, and PRICE.",
      },
    };
  }

  return {
    rows: deduped,
    meta: {
      headersFound,
      matchedTableCount,
      warning: null as string | null,
    },
  };
}

function extractRows(
  $: cheerio.CheerioAPI,
  rows: Element[],
  index: Record<string, number>
): ImportedInventoryRow[] {
  const out: ImportedInventoryRow[] = [];

  for (const row of rows) {
    const cellElems = $(row).find("td,th").toArray();
    const cells = cellElems.map((cell) => cleanCellText($(cell).text()));

    if (cells.length === 0) continue;

    const sku = firstNonEmpty(cells[idx(index, "SKU")], cells[idx(index, "ITEM")]);
    const farmCode = cleanFarmCode(cells[idx(index, "FARM")]);
    const commonName = cells[idx(index, "COMMON NAME")];
    // Business rule: inventory display/search should use COMMON NAME only.
    const name = firstNonEmpty(commonName, sku);
    const availabilityQty = parseInteger(
      firstNonEmpty(cells[idx(index, "SALEABLE QTY")], cells[idx(index, "SALEABLE QTY BY GRADE")]) ?? ""
    );
    const parsedPriceCents = parsePriceToCents(cells[idx(index, "PRICE")]);
    const priceCents = Number.isFinite(parsedPriceCents) && parsedPriceCents >= 0 ? parsedPriceCents : 0;
    const specification = cells[idx(index, "SPECIFICATION")];
    const category = cells[idx(index, "CATEGORY")];
    const description = cells[idx(index, "DESCRIPTION")];
    const longDescription = cells[idx(index, "LONG DESCRIPTION")];
    const itemDescription = cells[idx(index, "ITEM DESCRIPTION")];
    // Previously only the first of spec/category was kept, so words like "Golden" in CATEGORY
    // were dropped when SPECIFICATION was a short grade (e.g. "A").
    const quality =
      joinNonEmpty(
        " | ",
        specification,
        category,
        description,
        longDescription,
        itemDescription
      ) ?? firstNonEmpty(specification, category, description, longDescription, itemDescription, null);
    const viewPlantUrl = extractPlantImageHref($, cellElems, idx(index, "PLANT IMAGE"));

    if (!sku || !name) continue;
    if (!Number.isFinite(availabilityQty) || availabilityQty < 0) continue;

    out.push({
      sku,
      name,
      quality: quality ?? null,
      viewPlantUrl: viewPlantUrl ?? null,
      farmCode: farmCode ?? null,
      availabilityQty,
      priceCents,
      currency: "USD",
    });
  }

  return out;
}

function containsRequiredHeaders(headers: string[]) {
  return (
    REQUIRED_HEADERS.every((required) => headers.includes(required)) &&
    QTY_HEADERS.some((required) => headers.includes(required))
  );
}

function makeHeaderIndex(headers: string[]) {
  const index: Record<string, number> = {};
  headers.forEach((header, i) => {
    if (!index[header] && index[header] !== 0) index[header] = i;
  });
  return index;
}

function idx(index: Record<string, number>, key: string) {
  const value = index[key];
  return value ?? -1;
}

function normalizeHeader(v: string) {
  return cleanCellText(v).toUpperCase();
}

function cleanCellText(v: string) {
  return v
    .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseInteger(v: string | undefined) {
  if (!v) return NaN;
  const cleaned = v.replace(/[^0-9.-]/g, "");
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

function parsePriceToCents(v: string | undefined) {
  if (!v) return NaN;
  const cleaned = v.replace(/[^0-9.-]/g, "");
  const n = Number.parseFloat(cleaned);
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * 100);
}

function firstNonEmpty<T>(...values: Array<T | null | undefined>) {
  for (const v of values) {
    if (v === null || v === undefined) continue;
    if (typeof v === "string" && v.trim().length === 0) continue;
    return v;
  }
  return null;
}

/** Join string parts with `sep`; returns null if every part is empty. */
function joinNonEmpty(sep: string, ...parts: Array<string | null | undefined>): string | null {
  const trimmed = parts
    .map((p) => (typeof p === "string" ? p.trim() : ""))
    .filter((p) => p.length > 0);
  if (trimmed.length === 0) return null;
  return trimmed.join(sep);
}

function dedupeBySku(rows: ImportedInventoryRow[]) {
  const bySku = new Map<string, ImportedInventoryRow>();
  for (const row of rows) bySku.set(row.sku, row);
  return Array.from(bySku.values());
}

function extractRowsFromGlobalClasses(
  $: cheerio.CheerioAPI,
  index: Record<string, number>
) {
  const rows = $("tr.c48, tr.c53").toArray();
  return extractRows($, rows, index);
}

function extractPlantImageHref(
  $: cheerio.CheerioAPI,
  cellElems: Element[],
  plantImageIdx: number
) {
  if (plantImageIdx < 0 || plantImageIdx >= cellElems.length) return null;
  const href = $(cellElems[plantImageIdx]).find("a").first().attr("href");
  if (!href || typeof href !== "string") return null;
  const cleaned = href.trim();
  return cleaned.length > 0 ? cleaned : null;
}

function cleanFarmCode(v: string | undefined) {
  if (!v) return null;
  const cleaned = v.trim().toUpperCase();
  return cleaned.length > 0 ? cleaned : null;
}

