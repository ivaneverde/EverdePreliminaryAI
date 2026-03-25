import type { PreliminaryOrder, PreliminaryOrderLine } from "@prisma/client";

export type OrderWithLines = PreliminaryOrder & { lines: PreliminaryOrderLine[] };

/**
 * RFC 4180-style CSV field: quote if needed, escape internal quotes.
 */
function csvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function dollarsFromCents(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * Preliminary order as CSV rows for Oracle E-Business Suite / Order Management–style import.
 *
 * Column names follow common OE interface / custom-loader patterns (ORIG_SYS_*, ORDERED_ITEM, etc.).
 * Adjust this file if your DBA or concurrent program expects a different layout.
 */
export function buildOraclePreliminaryOrderCsv(
  order: OrderWithLines,
  salesRepName: string | null,
  salesRepEmail: string | null
): string {
  const sourceSystem = "EVERDE_PRELIM";
  const docRef = `${sourceSystem}-${order.orderNumber}`;
  const orderedDate = order.createdAt.toISOString().slice(0, 10);
  const requestDate = order.preferredDeliveryDate
    ? order.preferredDeliveryDate.toISOString().slice(0, 10)
    : "";

  const headers = [
    "SOURCE_SYSTEM",
    "ORIG_SYS_DOCUMENT_REF",
    "PRELIM_ORDER_NUMBER",
    "ORDERED_DATE",
    "CUSTOMER_NAME",
    "CONTACT",
    "SHIP_TO_ADDRESS",
    "PO_NUMBER",
    "REQUEST_SHIP_DATE",
    "SALES_REP_NAME",
    "SALES_REP_EMAIL",
    "LINE_NUMBER",
    "ORDERED_ITEM",
    "ITEM_DESCRIPTION",
    "ORDERED_QUANTITY",
    "UNIT_SELLING_PRICE",
    "CURRENCY_CODE",
    "LINE_AMOUNT",
    "ORDER_STATUS",
  ];

  const linesOut: string[] = [headers.map((h) => csvField(h)).join(",")];

  order.lines.forEach((line, idx) => {
    const lineNum = idx + 1;
    const row = [
      sourceSystem,
      docRef,
      order.orderNumber,
      orderedDate,
      order.customerName,
      order.contact ?? "",
      order.shipTo,
      order.poNumber ?? "",
      requestDate,
      salesRepName ?? "",
      salesRepEmail ?? "",
      lineNum,
      line.sku,
      line.itemName,
      line.quantity,
      dollarsFromCents(line.unitPriceCents),
      "USD",
      dollarsFromCents(line.lineTotalCents),
      order.status,
    ];
    linesOut.push(row.map((c) => csvField(c)).join(","));
  });

  return linesOut.join("\r\n");
}

export function preliminaryOrderCsvFilename(orderNumber: number): string {
  return `PreliminaryOrder_${orderNumber}_OracleImport.csv`;
}
