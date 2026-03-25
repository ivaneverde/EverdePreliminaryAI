import type { OrderWithLines } from "./oracleOrderCsv";

/**
 * CSV tuned for opening in Excel and pasting into an Oracle Web ADI workbook.
 * - UTF-8 BOM so Excel recognizes encoding on double-click (Windows).
 * - Human-readable column names; one row per order line (header fields repeated).
 *
 * Web ADI column order is defined in EBS (integrator / layout). Reorder columns here
 * to match your downloaded ADI template once your functional team shares the layout.
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

export function buildWebAdiFriendlyCsv(order: OrderWithLines): string {
  const requestDate = order.preferredDeliveryDate
    ? order.preferredDeliveryDate.toISOString().slice(0, 10)
    : "";

  const headers = [
    "Prelim_Order_Number",
    "Customer_Name",
    "Contact",
    "Ship_To",
    "PO_Number",
    "Request_Ship_Date",
    "Sales_Rep_Name",
    "Sales_Rep_Email",
    "Line_Number",
    "SKU",
    "Item_Description",
    "Quantity",
    "Unit_Price",
    "Line_Total",
    "Currency",
    "Order_Status",
  ];

  const linesOut: string[] = [headers.map((h) => csvField(h)).join(",")];

  order.lines.forEach((line, idx) => {
    const lineNum = idx + 1;
    const row = [
      order.orderNumber,
      order.customerName,
      order.contact ?? "",
      order.shipTo,
      order.poNumber ?? "",
      requestDate,
      order.salesRepName ?? "",
      order.salesRepEmail ?? "",
      lineNum,
      line.sku,
      line.itemName,
      line.quantity,
      dollarsFromCents(line.unitPriceCents),
      dollarsFromCents(line.lineTotalCents),
      "USD",
      order.status,
    ];
    linesOut.push(row.map((c) => csvField(c)).join(","));
  });

  // Excel on Windows: BOM helps open UTF-8 CSV with commas correctly.
  return "\uFEFF" + linesOut.join("\r\n");
}

export function webAdiCsvFilename(orderNumber: number): string {
  return `PreliminaryOrder_${orderNumber}_WebADI_Excel.csv`;
}
