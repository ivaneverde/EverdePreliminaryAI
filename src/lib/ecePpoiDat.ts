import { readFileSync } from "fs";
import { join } from "path";
import type { OrderWithLines } from "./oracleOrderCsv";

/**
 * Oracle ECE-style flat file (PPOI) derived from your sample `ECEPOI_HD.dat`.
 * One order = 0010…1900 header block + repeating 2000→4230 line sets.
 *
 * Set `ECE_CUSTOMER_REF` (8 chars) / `ECE_OPERATING_UNIT` (6 chars) to match your org.
 * The item column uses your SKU in the 10-character slot where the sample had an inventory item ID —
 * map SKUs in Oracle if your loader expects internal IDs.
 */

function env(name: string, fallback: string): string {
  const v = process.env[name];
  return v != null && v.trim() !== "" ? v.trim() : fallback;
}

function yyyymmdd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function padEndAscii(s: string, len: number): string {
  const t = s.replace(/[^\x20-\x7E]/g, "?").slice(0, len);
  return t.padEnd(len, " ");
}

function padStartAscii(s: string, len: number): string {
  const t = s.replace(/[^\x20-\x7E]/g, "?").slice(-len);
  return t.padStart(len, " ");
}

function preserveLength(original: string, next: string): string {
  if (next.length === original.length) return next;
  if (next.length < original.length) return next.padEnd(original.length, " ");
  return next.slice(0, original.length);
}

/** External ref like sample `HD-7270` (7 chars). */
function externalRef(orderNumber: number): string {
  const n = String(orderNumber);
  if (n.length <= 6) return `P${n.padStart(6, "0")}`;
  return padEndAscii(`P${n}`, 7).slice(0, 7);
}

function setPriceBlock(line: string, priceLabelIndex: number, cents: number): string {
  const start = priceLabelIndex - 12;
  const end = priceLabelIndex + 18;
  const width = end - start;
  const s = (cents / 100).toFixed(2);
  const inner = s.length <= 12 ? s.padStart(12, " ") : s.slice(-12);
  const block = inner.padStart(width, " ").slice(-width);
  return line.slice(0, start) + block + line.slice(end);
}

function replaceQtyEa(line: string, qty: number): string {
  const m = line.match(/\d+Ea/);
  if (!m || m.index === undefined) return line;
  const old = m[0];
  const neu = `${qty}Ea`;
  const delta = neu.length - old.length;
  let before = line.slice(0, m.index);
  const after = line.slice(m.index + old.length);
  if (delta > 0) {
    let removed = 0;
    while (removed < delta && before.endsWith(" ")) {
      before = before.slice(0, -1);
      removed++;
    }
  } else if (delta < 0) {
    before += " ".repeat(-delta);
  }
  return preserveLength(line, before + neu + after);
}

function loadSampleBlock(): string[] {
  const p = join(process.cwd(), "src/lib/ecePpoiSampleBlock.txt");
  const raw = readFileSync(p, "utf8");
  return raw.split(/\r?\n/).filter((l) => l.length > 0);
}

/**
 * Build one PPOI-style document for a preliminary order (header + lines).
 */
export function buildEcePpoiDat(order: OrderWithLines): string {
  const templates = loadSampleBlock();
  if (templates.length < 10) {
    throw new Error("ecePpoiSampleBlock.txt must contain 10 template lines (0010–4230).");
  }

  const [t0, t1, t2, t3, t4, t5, t6, t7, t8, t9] = templates;

  const custRef = padStartAscii(env("ECE_CUSTOMER_REF", "10011432"), 8).slice(-8);
  const opUnit = padEndAscii(env("ECE_OPERATING_UNIT", "HD VMI"), 6).slice(0, 6);
  const tranId = padStartAscii(String(order.orderNumber), 10).slice(-10);
  const ref = externalRef(order.orderNumber);
  const orderDate = yyyymmdd(order.createdAt);
  const shipYmd = order.preferredDeliveryDate
    ? yyyymmdd(order.preferredDeliveryDate)
    : orderDate;

  const lineCount = order.lines.length;
  const countField = padStartAscii(String(Math.min(lineCount, 99)), 2).slice(-2);

  let l0 = t0;
  l0 = l0.replace("7704338211", tranId);
  l0 = l0.replace(/HD-7270/g, ref);
  l0 = l0.replace(/20260318/g, orderDate);

  let l1 = t1;
  l1 = l1.replace(/10011432/g, custRef);
  l1 = l1.replace("20260317", orderDate);
  l1 = l1.replace(/HD VMI/g, opUnit);

  let l2 = t2.replace(/HD-7270/g, ref);
  let l3 = t3.replace(/HD-7270/g, ref);

  let l4 = t4.replace("1900RSRES10011432", `1900RSRES${custRef}`);
  const idx12 = l4.lastIndexOf("12");
  if (idx12 >= 0) {
    l4 = l4.slice(0, idx12) + countField + l4.slice(idx12 + 2);
  }

  const out: string[] = [l0, l1, l2, l3, l4];

  const pIdx3000 = t6.indexOf("28.55");
  const pIdx3030 = t7.indexOf("28.55");

  order.lines.forEach((line, idx) => {
    const lineNum = idx + 1;
    const itm = `ITITM${String(lineNum).padStart(4, "0")}`;
    const itemSlot = padEndAscii(line.sku, 10).slice(0, 10);
    const qty = line.quantity;

    let r5 = t5.replace(/ITITM\d{4}/, itm);
    r5 = r5.replace("1013370289", itemSlot);
    r5 = r5.replace(/10011432/g, custRef);

    let r6 = t6.replace(/(LNLN1 )(\d+)/, (_, prefix: string, oldQty: string) => {
      const neu = String(qty);
      const slot = oldQty.length;
      const fit = neu.length <= slot ? neu.padStart(slot, " ") : neu.slice(0, slot);
      return prefix + fit;
    });
    if (pIdx3000 >= 0) r6 = setPriceBlock(r6, pIdx3000, line.unitPriceCents);

    let r7 = t7;
    if (pIdx3030 >= 0) r7 = setPriceBlock(r7, pIdx3030, line.unitPriceCents);

    let r8 = t8.replace("20260324", shipYmd);
    r8 = replaceQtyEa(r8, qty);

    let r9 = t9.replace(/HD VMI/g, opUnit).replace(/HD-7270/g, ref);

    out.push(r5, r6, r7, r8, r9);
  });

  return out.join("\r\n");
}

export function ecePpoiDatFilename(orderNumber: number): string {
  return `ECEPOI_PRELIM_${orderNumber}.dat`;
}
