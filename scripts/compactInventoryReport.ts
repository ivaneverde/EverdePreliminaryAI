import { readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import * as cheerio from "cheerio";

type HeaderIndex = Record<string, number>;

const SOURCE_HEADERS = [
  "FARM",
  "ITEM",
  "COMMON NAME",
  "SPECIFICATION",
  "CATEGORY",
  "SALEABLE QTY BY GRADE",
  "PRICE",
  "PLANT IMAGE",
] as const;

const OUTPUT_HEADERS = [
  "FARM",
  "ITEM",
  "COMMON NAME",
  "SPECIFICATION",
  "CATEGORY",
  "SALEABLE QTY",
  "PRICE",
  "PLANT IMAGE",
] as const;

function normalizeHeader(v: string) {
  return v.replace(/\s+/g, " ").trim().toUpperCase();
}

function cleanText(v: string) {
  return v.replace(/\s+/g, " ").trim();
}

function escapeHtml(v: string) {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function makeHeaderIndex(headers: string[]): HeaderIndex {
  const index: HeaderIndex = {};
  headers.forEach((h, i) => {
    if (index[h] == null) index[h] = i;
  });
  return index;
}

function requireHeader(index: HeaderIndex, header: string) {
  if (index[header] == null) {
    throw new Error(`Missing required source header: ${header}`);
  }
}

function parseRows(inputPath: string) {
  const raw = readFileSync(inputPath, "utf-8");
  const $ = cheerio.load(raw);
  const tables = $("table").toArray();
  let parsedRows: Array<Record<(typeof OUTPUT_HEADERS)[number], string>> = [];

  for (const table of tables) {
    const rows = $(table).find("tr").toArray();
    if (rows.length < 2) continue;

    const headerCells = $(rows[0])
      .find("td,th")
      .toArray()
      .map((cell) => normalizeHeader($(cell).text()));

    const headerIndex = makeHeaderIndex(headerCells);
    const hasAll = SOURCE_HEADERS.every((h) => headerIndex[h] != null);
    if (!hasAll) continue;

    for (const header of SOURCE_HEADERS) requireHeader(headerIndex, header);

    const tableRows: Array<Record<(typeof OUTPUT_HEADERS)[number], string>> = [];
    for (const row of rows.slice(1)) {
      const cellElems = $(row).find("td,th").toArray();
      if (cellElems.length === 0) continue;
      const cells = cellElems.map((cell) => cleanText($(cell).text()));

      const get = (header: (typeof SOURCE_HEADERS)[number]) => {
        const idx = headerIndex[header];
        return idx == null || idx < 0 || idx >= cells.length ? "" : cells[idx];
      };

      const getPlantLink = () => {
        const idx = headerIndex["PLANT IMAGE"];
        if (idx == null || idx < 0 || idx >= cellElems.length) return "";
        return cleanText($(cellElems[idx]).find("a").first().attr("href") ?? "");
      };

      const item = get("ITEM");
      const commonName = get("COMMON NAME");
      const qtyByGrade = get("SALEABLE QTY BY GRADE");
      if (!item || !commonName || !qtyByGrade) continue;

      tableRows.push({
        FARM: get("FARM"),
        ITEM: item,
        "COMMON NAME": commonName,
        SPECIFICATION: get("SPECIFICATION"),
        CATEGORY: get("CATEGORY"),
        "SALEABLE QTY": qtyByGrade,
        PRICE: get("PRICE"),
        "PLANT IMAGE": getPlantLink(),
      });
    }

    if (tableRows.length > 0) {
      parsedRows = tableRows;
      break;
    }
  }

  if (parsedRows.length === 0) {
    throw new Error("No compatible inventory table found in source report.");
  }

  return parsedRows;
}

function toHtml(rows: Array<Record<(typeof OUTPUT_HEADERS)[number], string>>) {
  const headerHtml = OUTPUT_HEADERS.map((h) => `<th>${escapeHtml(h)}</th>`).join("");
  const bodyHtml = rows
    .map((row) => {
      const cells = OUTPUT_HEADERS.map((h) => {
        const value = row[h] ?? "";
        if (h === "PLANT IMAGE" && value) {
          const safe = escapeHtml(value);
          return `<td><a href="${safe}">View Plant</a></td>`;
        }
        return `<td>${escapeHtml(value)}</td>`;
      }).join("");
      return `<tr>${cells}</tr>`;
    })
    .join("\n");

  return `<!doctype html>
<html>
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <title>Compact Inventory Report</title>
  </head>
  <body>
    <table>
      <tr>${headerHtml}</tr>
      ${bodyHtml}
    </table>
  </body>
</html>
`;
}

function main() {
  const inputArg = process.argv[2];
  const outputArg = process.argv[3];
  if (!inputArg) {
    throw new Error(
      "Usage: npm run inventory:compact -- <input-report.xls> [output-compact.xls]"
    );
  }

  const inputPath = resolve(inputArg);
  const outputPath = resolve(
    outputArg && outputArg.trim().length > 0
      ? outputArg
      : `${basename(inputPath).replace(/\.xls[x]?$/i, "")}_compact.xls`
  );

  const rows = parseRows(inputPath);
  const html = toHtml(rows);
  writeFileSync(outputPath, html, "utf-8");

  // Keep output concise so this can be run in scripts/automation logs.
  console.log(`Wrote compact report: ${outputPath}`);
  console.log(`Rows: ${rows.length}`);
}

main();
