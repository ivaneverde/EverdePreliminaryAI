import { readFileSync } from "node:fs";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { resolveCompanyLogoPath } from "./companyLogo";
import type { OrderWithLines } from "./oracleOrderCsv";
import { formatMoneyFromCents } from "./money";

export function preliminaryOrderPdfFilename(orderNumber: number): string {
  return `PreliminaryOrder_${orderNumber}_Acknowledgement.pdf`;
}

export async function buildPreliminaryOrderPdf(order: OrderWithLines): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]); // US Letter
  const helvetica = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const margin = 40;
  const pageWidth = 612 - margin * 2;
  const topY = 792 - margin;
  let y = topY;
  let logoBottomY = topY - 10;

  // Header: logo at left, quote banner on top, centered title below.
  try {
    const logoPath = resolveCompanyLogoPath();
    if (!logoPath) throw new Error("no logo");
    const png = await pdf.embedPng(readFileSync(logoPath));
    const targetW = 128;
    const scale = targetW / png.width;
    const h = png.height * scale;

    // White backdrop to visually neutralize logo area.
    page.drawRectangle({
      x: margin - 2,
      y: topY - h - 2,
      width: targetW + 4,
      height: h + 4,
      color: rgb(1, 1, 1),
    });

    page.drawImage(png, {
      x: margin,
      y: topY - h,
      width: targetW,
      height: h,
    });
    logoBottomY = topY - h;
  } catch {
    // Continue without logo.
  }

  const quoteText = "THIS IS A QUOTE ONLY";
  const quoteW = bold.widthOfTextAtSize(quoteText, 14);
  page.drawText(quoteText, {
    x: margin + (pageWidth - quoteW) / 2,
    y: topY - 14,
    size: 14,
    font: bold,
    color: rgb(0, 0, 0),
  });

  const title = "Preliminary Order Acknowledgement";
  const titleW = bold.widthOfTextAtSize(title, 18);
  const titleY = Math.min(topY - 74, logoBottomY - 20);
  page.drawText(title, {
    x: margin + (pageWidth - titleW) / 2,
    y: titleY,
    size: 18,
    font: bold,
    color: rgb(0, 0, 0),
  });

  y = titleY - 26;
  page.drawText(`Order #: ${order.orderNumber}`, { x: margin, y, size: 10, font: helvetica });
  page.drawText(`Status: ${order.status}`, { x: margin + 220, y, size: 10, font: helvetica });
  y -= 14;
  page.drawText(`Created: ${new Date(order.createdAt).toISOString().slice(0, 10)}`, {
    x: margin,
    y,
    size: 10,
    font: helvetica,
  });

  const info: Array<[string, string]> = [
    ["Customer", order.customerName],
    ["Contact", order.contact?.trim() || "Not provided"],
    ["Ship To", order.shipTo],
    [
      "Preferred Delivery Date",
      order.preferredDeliveryDate
        ? new Date(order.preferredDeliveryDate).toISOString().slice(0, 10)
        : "Not provided",
    ],
    ["PO Number", order.poNumber ?? "AUTO"],
    ["Sales Rep", order.salesRepName?.trim() || "Not provided"],
    ["Sales Rep Email", order.salesRepEmail?.trim() || "Not provided"],
  ];

  y -= 20;
  for (const [k, v] of info) {
    page.drawText(`${k}:`, { x: margin, y, size: 10, font: bold });
    page.drawText(v, { x: margin + 140, y, size: 10, font: helvetica, maxWidth: pageWidth - 140 });
    y -= 14;
  }

  y -= 8;
  const cols = [120, 220, 50, 90, 90];
  const headers = ["SKU", "Item Number / Description", "QTY", "UNIT PRICE", "PRICE"];
  let x = margin;
  let hY = y;
  for (let i = 0; i < cols.length; i++) {
    page.drawRectangle({
      x,
      y: hY - 2,
      width: cols[i],
      height: 16,
      borderColor: rgb(0.75, 0.75, 0.75),
      borderWidth: 1,
      color: rgb(0.94, 0.92, 0.9),
    });
    page.drawText(headers[i], { x: x + 4, y: hY + 2, size: 9, font: bold });
    x += cols[i];
  }

  y -= 18;
  let total = 0;
  for (const line of order.lines) {
    total += line.lineTotalCents;
    if (y < 70) break; // keep single-page for now
    const vals = [
      line.sku,
      line.itemName,
      String(line.quantity),
      formatMoneyFromCents(line.unitPriceCents, "USD"),
      formatMoneyFromCents(line.lineTotalCents, "USD"),
    ];
    x = margin;
    for (let i = 0; i < cols.length; i++) {
      page.drawText(vals[i], { x: x + 4, y, size: 9, font: helvetica, maxWidth: cols[i] - 8 });
      x += cols[i];
    }
    y -= 14;
  }

  y -= 6;
  page.drawText(`Total: ${formatMoneyFromCents(total, "USD")}`, {
    x: margin + cols[0] + cols[1] + cols[2] + cols[3] - 20,
    y,
    size: 12,
    font: bold,
  });

  const bytes = await pdf.save();
  return Buffer.from(bytes);
}
