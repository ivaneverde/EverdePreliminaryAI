import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import * as XLSX from "xlsx";
import type { OrderWithLines } from "./oracleOrderCsv";

function env(name: string): string | undefined {
  const v = process.env[name];
  return v != null && v.trim() !== "" ? v.trim() : undefined;
}

function envBool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v == null || v.trim() === "") return fallback;
  return v.trim().toLowerCase() === "true";
}

function colToRef(colNumber1Based: number, rowNumber1Based: number): string {
  let n = colNumber1Based;
  let col = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    col = String.fromCharCode(65 + rem) + col;
    n = Math.floor((n - 1) / 26);
  }
  return `${col}${rowNumber1Based}`;
}

function setCellString(ws: XLSX.WorkSheet, ref: string, value: string) {
  ws[ref] = { t: "s", v: value };
}

function setCellNumber(ws: XLSX.WorkSheet, ref: string, value: number) {
  ws[ref] = { t: "n", v: value };
}

function setCellDate(ws: XLSX.WorkSheet, ref: string, value: Date) {
  ws[ref] = { t: "d", v: value, z: "m/d/yyyy" };
}

function parseCityFromShipTo(shipTo: string): string {
  const parts = shipTo.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) return parts[1];
  return shipTo.trim();
}

function templatePathFromEnv(): string | null {
  const explicit = env("ORACLE_ORDER_TEMPLATE_PATH");
  if (explicit && existsSync(explicit)) return explicit;

  // Convenience fallback for local development.
  const desktopDefault = "C:\\Users\\isunderland\\Desktop\\OrderTemplate.xlsm";
  if (existsSync(desktopDefault)) return desktopDefault;

  return null;
}

/**
 * Builds a prefilled macro workbook copy based on your Oracle upload template.
 * Returns null when the template path is unavailable.
 */
export function buildPrefilledOracleTemplateWorkbook(order: OrderWithLines): {
  filename: string;
  content: Buffer;
} | null {
  const templatePath = templatePathFromEnv();
  if (!templatePath) return null;

  // Default: attach original template unchanged (smallest file size, preserves macro behavior).
  // Set ORACLE_TEMPLATE_PREFILL=true to generate a filled copy instead.
  if (!envBool("ORACLE_TEMPLATE_PREFILL", false)) {
    return {
      filename: "OrderTemplate.xlsm",
      content: readFileSync(templatePath),
    };
  }

  const comGenerated = buildPrefilledWithExcelCom(templatePath, order);
  if (comGenerated) {
    return {
      filename: "OrderTemplate.xlsm",
      content: comGenerated,
    };
  }

  const raw = readFileSync(templatePath);
  const wb = XLSX.read(raw, {
    type: "buffer",
    cellDates: true,
    bookVBA: true,
  });

  const ws = wb.Sheets.Template;
  if (!ws) return null;

  // Header area consumed by Button2_Click macro.
  setCellString(ws, "B1", order.customerName);
  setCellDate(ws, "B2", order.preferredDeliveryDate ?? new Date());
  setCellString(ws, "B3", order.shipTo);
  setCellString(ws, "B4", env("ORACLE_TEMPLATE_ORDER_TYPE") ?? "STE LANDSCAPE NORTH");
  setCellNumber(ws, "B5", order.lines.length);
  setCellString(ws, "B6", env("ORACLE_TEMPLATE_ADDRESS_CATEGORY") ?? "COSUS");

  // Maintain the template's expected label cells.
  setCellString(ws, "A11", "Sku #");
  setCellString(ws, "A12", "Item");
  setCellString(ws, "A13", "Rep");
  setCellString(ws, "B13", "Store #");
  setCellString(ws, "C13", "City");
  setCellString(ws, "D13", "PO#");
  setCellString(ws, "G13", "Internal #");

  const dataRow = 14;
  setCellString(ws, `A${dataRow}`, order.salesRepName ?? "");
  setCellString(ws, `B${dataRow}`, env("ORACLE_TEMPLATE_STORE_NUMBER") ?? "");
  setCellString(ws, `C${dataRow}`, parseCityFromShipTo(order.shipTo));
  setCellString(ws, `D${dataRow}`, order.poNumber ?? "");
  setCellString(ws, `G${dataRow}`, "1");

  // SKU columns begin at H.
  const skuStartCol = 8;
  order.lines.forEach((line, idx) => {
    const col = skuStartCol + idx;
    const row11 = colToRef(col, 11);
    const row12 = colToRef(col, 12);
    const row13 = colToRef(col, 13);
    const row14 = colToRef(col, dataRow);
    setCellString(ws, row11, line.sku);
    setCellString(ws, row12, line.itemName);
    setCellString(ws, row13, line.sku);
    setCellNumber(ws, row14, line.quantity);
  });

  const out = XLSX.write(wb, {
    type: "buffer",
    bookType: "xlsm",
    bookVBA: true,
  }) as Buffer;

  return {
    filename: "OrderTemplate.xlsm",
    content: out,
  };
}

function buildPrefilledWithExcelCom(templatePath: string, order: OrderWithLines): Buffer | null {
  const workDir = mkdtempSync(join(tmpdir(), "everde-ordertemplate-"));
  const workbookPath = join(workDir, "OrderTemplate.xlsm");
  const payloadPath = join(workDir, "payload.json");
  const scriptPath = join(workDir, "prefill.ps1");
  try {
    writeFileSync(workbookPath, readFileSync(templatePath));
    writeFileSync(
      payloadPath,
      JSON.stringify({
        customerName: order.customerName,
        preferredDeliveryDate: (order.preferredDeliveryDate ?? new Date()).toISOString().slice(0, 10),
        shipTo: order.shipTo,
        orderType: env("ORACLE_TEMPLATE_ORDER_TYPE") ?? "SO CA STE IND/LANDSCAPE",
        addressCategory: env("ORACLE_TEMPLATE_ADDRESS_CATEGORY") ?? "",
        storeNumber: env("ORACLE_TEMPLATE_STORE_NUMBER") ?? "",
        salesRepName: order.salesRepName ?? "",
        poNumber: order.poNumber ?? "",
        city: parseCityFromShipTo(order.shipTo),
        lines: order.lines.map((line, idx) => ({
          sku: line.sku,
          itemName: line.itemName,
          quantity: line.quantity,
          internalNo: idx === 0 ? line.sku : "",
        })),
      }),
      "utf-8"
    );

    const psScript = `
param([string]$WorkbookPath,[string]$PayloadPath)
$ErrorActionPreference = 'Stop'
$excel = $null; $wb = $null
try {
  $data = Get-Content $PayloadPath -Raw | ConvertFrom-Json
  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  $wb = $excel.Workbooks.Open($WorkbookPath)
  $ws = $wb.Worksheets.Item('Template')
  $ws.Range('B1').Value2 = $data.customerName
  $ws.Range('B2').Value2 = $data.preferredDeliveryDate
  $ws.Range('B3').Value2 = $data.shipTo
  $ws.Range('B4').Value2 = $data.orderType
  $ws.Range('B5').Value2 = [string]$data.lines.Count
  $ws.Range('B6').Value2 = $data.addressCategory
  # Single-order mode: clear secondary rows / historical template data.
  $ws.Range('A15:IV300').Value2 = ''
  # Clear SKU blocks before writing current order.
  $ws.Range('H8:ZZ8').Value2 = ''
  $ws.Range('H11:ZZ14').Value2 = ''
  $ws.Range('A11').Value2 = 'Sku #'
  $ws.Range('A12').Value2 = 'Item'
  $ws.Range('A13').Value2 = 'Rep'
  $ws.Range('B13').Value2 = 'Store #'
  $ws.Range('C13').Value2 = 'City'
  $ws.Range('D13').Value2 = 'PO#'
  $ws.Range('G13').Value2 = 'Internal #'
  $ws.Range('A14').Value2 = $data.salesRepName
  $ws.Range('B14').Value2 = $data.storeNumber
  $ws.Range('C14').Value2 = $data.city
  $ws.Range('D14').Value2 = $data.poNumber
  if ($data.lines.Count -gt 0) { $ws.Range('G14').Value2 = $data.lines[0].internalNo }
  for ($i = 0; $i -lt $data.lines.Count; $i++) {
    $col = 8 + $i
    $line = $data.lines[$i]
    $ws.Cells.Item(11, $col).Value2 = $line.sku
    $ws.Cells.Item(12, $col).Value2 = $line.itemName
    $ws.Cells.Item(13, $col).Value2 = $line.sku
    $ws.Cells.Item(14, $col).Value2 = [string]$line.quantity
    # Keep template style totals row: e.g., I8 =SUM(I14:I15)
    $colLetter = ''
    $n = $col
    while ($n -gt 0) {
      $r = ($n - 1) % 26
      $colLetter = [char](65 + $r) + $colLetter
      $n = [math]::Floor(($n - 1) / 26)
    }
    $ws.Cells.Item(8, $col).Formula = '=SUM(' + $colLetter + '14:' + $colLetter + '15)'
  }
  $wb.Save()
}
finally {
  if ($wb -ne $null) { $wb.Close($true) | Out-Null }
  if ($excel -ne $null) { $excel.Quit() }
}
`;
    writeFileSync(scriptPath, psScript, "utf-8");

    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        scriptPath,
        "-WorkbookPath",
        workbookPath,
        "-PayloadPath",
        payloadPath,
      ],
      { stdio: "pipe" }
    );

    return readFileSync(workbookPath);
  } catch {
    return null;
  } finally {
    try {
      rmSync(workDir, { recursive: true, force: true });
    } catch {
      // ignore temp cleanup errors
    }
  }
}
