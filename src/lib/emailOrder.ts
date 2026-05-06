import { isIP } from "node:net";
import nodemailer from "nodemailer";
import type { PreliminaryOrder, PreliminaryOrderLine } from "@prisma/client";
import { formatMoneyFromCents } from "./money";
import { buildPrefilledOracleTemplateWorkbook } from "./oracleTemplateWorkbook";
import {
  buildOraclePreliminaryOrderCsv,
  preliminaryOrderCsvFilename,
} from "./oracleOrderCsv";
import { buildPreliminaryOrderPdf, preliminaryOrderPdfFilename } from "./orderPdf";

export type OrderWithLines = PreliminaryOrder & { lines: PreliminaryOrderLine[] };

function env(name: string): string | undefined {
  const v = process.env[name];
  return v != null && v.trim() !== "" ? v.trim() : undefined;
}

function envBool(name: string, defaultValue: boolean): boolean {
  const v = env(name);
  if (!v) return defaultValue;
  return v.toLowerCase() === "true";
}

function envNumber(name: string, defaultValue: number): number {
  const v = env(name);
  if (!v) return defaultValue;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : defaultValue;
}

function envAttachmentMode(): "csv" | "xlsm" | "both" {
  const v = (env("ORACLE_EMAIL_ATTACHMENT_MODE") ?? "xlsm").toLowerCase();
  if (v === "csv" || v === "xlsm" || v === "both") return v;
  return "xlsm";
}

function smtpHostLooksLikeResend(host: string): boolean {
  const h = host.toLowerCase();
  return h === "smtp.resend.com" || h.endsWith(".resend.com");
}

function smtpHostLooksLikeMicrosoft365(host: string): boolean {
  const h = host.toLowerCase();
  return h === "smtp.office365.com" || h === "smtp-legacy.office365.com";
}

function smtpHostLooksLikeGmail(host: string): boolean {
  return host.toLowerCase() === "smtp.gmail.com";
}

/**
 * True when outbound email can be attempted.
 * Resend / Microsoft 365 / Gmail require auth; internal relays may omit USER/PASS.
 */
export function isSmtpConfigured(): boolean {
  const host = env("EMAIL_SMTP_HOST");
  const from = env("EMAIL_FROM");
  if (!host || !from) return false;
  if (
    smtpHostLooksLikeResend(host) ||
    smtpHostLooksLikeMicrosoft365(host) ||
    smtpHostLooksLikeGmail(host)
  ) {
    return Boolean(env("EMAIL_SMTP_USER") && env("EMAIL_SMTP_PASS"));
  }
  return true;
}

function createTransport() {
  const host = env("EMAIL_SMTP_HOST");
  const from = env("EMAIL_FROM");
  if (!host || !from) {
    throw new Error("EMAIL_SMTP_HOST and EMAIL_FROM must be set to send mail.");
  }

  const port = Number(
    env("EMAIL_SMTP_PORT") ?? (smtpHostLooksLikeGmail(host) ? "587" : "25")
  );
  const secure = env("EMAIL_SMTP_SECURE") === "true";
  const user = env("EMAIL_SMTP_USER");
  const pass = env("EMAIL_SMTP_PASS");

  const rejectTlsEnv = env("EMAIL_SMTP_TLS_REJECT_UNAUTHORIZED");
  const strictTls = env("EMAIL_SMTP_TLS_STRICT") === "true";
  const tlsServername = env("EMAIL_SMTP_TLS_SERVERNAME");

  // Connecting by IP (common for internal relays) breaks hostname verification: the cert lists DNS names,
  // not "10.x.x.x". Relax verification for IP literals unless EMAIL_SMTP_TLS_STRICT=true.
  const hostIsIp = isIP(host) !== 0;
  let rejectUnauthorized: boolean;
  if (rejectTlsEnv === "false") {
    rejectUnauthorized = false;
  } else if (rejectTlsEnv === "true") {
    rejectUnauthorized = true;
  } else if (hostIsIp && !strictTls) {
    rejectUnauthorized = false;
  } else {
    rejectUnauthorized = true;
  }

  const tls: { rejectUnauthorized: boolean; servername?: string } = {
    rejectUnauthorized,
  };
  if (tlsServername) {
    tls.servername = tlsServername;
  }

  const office365 = smtpHostLooksLikeMicrosoft365(host);
  const gmail = smtpHostLooksLikeGmail(host);
  const requireTls = office365 || gmail || envBool("EMAIL_SMTP_REQUIRE_TLS", false);

  return nodemailer.createTransport({
    host,
    port: Number.isFinite(port) ? port : 25,
    secure,
    auth: user && pass ? { user, pass } : undefined,
    tls,
    ...(requireTls ? { requireTLS: true as const } : {}),
  });
}

function buildPlainText(order: OrderWithLines, salesRepName: string | null): string {
  const totalCents = order.lines.reduce((s, l) => s + l.lineTotalCents, 0);
  const lines = order.lines
    .map(
      (l) =>
        `  ${l.sku}  ${l.itemName}  qty ${l.quantity}  @ ${formatMoneyFromCents(
          l.unitPriceCents,
          "USD"
        )}  = ${formatMoneyFromCents(l.lineTotalCents, "USD")}`
    )
    .join("\n");

  const delivery = order.preferredDeliveryDate
    ? order.preferredDeliveryDate.toISOString().slice(0, 10)
    : "Not provided";

  return [
    `Preliminary order #${order.orderNumber}`,
    ``,
    `Sales representative: ${salesRepName?.trim() ? salesRepName.trim() : "(not specified)"}`,
    ``,
    `Customer: ${order.customerName}`,
    `Contact: ${order.contact?.trim() ? order.contact.trim() : "Not provided"}`,
    `Ship to: ${order.shipTo}`,
    `Special Instructions / Jobsite Notes: ${order.specialInstructions?.trim() ? order.specialInstructions.trim() : "Not provided"}`,
    `Preferred delivery: ${delivery}`,
    `PO: ${order.poNumber ?? "—"}`,
    `Status: ${order.status}`,
    ``,
    `Line items:`,
    lines,
    ``,
    `Total: ${formatMoneyFromCents(totalCents, "USD")}`,
    ``,
    `Attached: prefilled OrderTemplate workbook (.xlsm) when configured, plus a PDF acknowledgement (quote only).`,
    ``,
    `— Everde preliminary order (automated message)`,
  ].join("\n");
}

function buildHtml(order: OrderWithLines, salesRepName: string | null): string {
  const totalCents = order.lines.reduce((s, l) => s + l.lineTotalCents, 0);
  const delivery = order.preferredDeliveryDate
    ? order.preferredDeliveryDate.toISOString().slice(0, 10)
    : "Not provided";

  const rows = order.lines
    .map(
      (l) =>
        `<tr><td>${escapeHtml(l.sku)}</td><td>${escapeHtml(l.itemName)}</td><td style="text-align:right">${l.quantity}</td><td style="text-align:right">${formatMoneyFromCents(
          l.unitPriceCents,
          "USD"
        )}</td><td style="text-align:right">${formatMoneyFromCents(l.lineTotalCents, "USD")}</td></tr>`
    )
    .join("");

  return `<!DOCTYPE html><html><body style="font-family:Segoe UI,Roboto,sans-serif;font-size:14px;color:#222">
<p><strong>Preliminary order #${order.orderNumber}</strong></p>
<p>Sales representative: <strong>${escapeHtml(salesRepName?.trim() || "(not specified)")}</strong></p>
<table style="border-collapse:collapse;margin:12px 0">
<tr><td style="padding:2px 12px 2px 0;color:#555">Customer</td><td>${escapeHtml(order.customerName)}</td></tr>
<tr><td style="padding:2px 12px 2px 0;color:#555">Contact</td><td>${escapeHtml(order.contact?.trim() || "Not provided")}</td></tr>
<tr><td style="padding:2px 12px 2px 0;color:#555">Ship to</td><td>${escapeHtml(order.shipTo)}</td></tr>
<tr><td style="padding:2px 12px 2px 0;color:#555">Special Instructions / Jobsite Notes</td><td>${escapeHtml(order.specialInstructions?.trim() || "Not provided")}</td></tr>
<tr><td style="padding:2px 12px 2px 0;color:#555">Preferred delivery</td><td>${escapeHtml(delivery)}</td></tr>
<tr><td style="padding:2px 12px 2px 0;color:#555">PO</td><td>${escapeHtml(order.poNumber ?? "—")}</td></tr>
<tr><td style="padding:2px 12px 2px 0;color:#555">Status</td><td>${escapeHtml(order.status)}</td></tr>
</table>
<table style="border-collapse:collapse;width:100%;max-width:720px">
<thead><tr style="border-bottom:1px solid #ccc"><th align="left">SKU</th><th align="left">Item</th><th align="right">Qty</th><th align="right">Unit</th><th align="right">Line</th></tr></thead>
<tbody>${rows}</tbody>
</table>
<p style="font-size:16px;font-weight:700">Total: ${formatMoneyFromCents(totalCents, "USD")}</p>
<p style="color:#666;font-size:12px">Attached: prefilled <strong>OrderTemplate .xlsm</strong> (when configured) and <strong>Preliminary Order Acknowledgement PDF</strong> (quote only).</p>
<p style="color:#666;font-size:12px">Everde preliminary order (automated message)</p>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Sends a copy of the preliminary order to the sales rep's mailbox.
 * Expects SMTP env to be configured (internal relay is fine).
 */
export async function sendPreliminaryOrderEmailToSalesRep(
  order: OrderWithLines,
  salesRepEmail: string,
  salesRepName: string | null
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const from = env("EMAIL_FROM");
    if (!from || !isSmtpConfigured()) {
      const h = env("EMAIL_SMTP_HOST");
      let detail =
        "Set EMAIL_SMTP_HOST and EMAIL_FROM.";
      if (h && smtpHostLooksLikeResend(h) && (!env("EMAIL_SMTP_USER") || !env("EMAIL_SMTP_PASS"))) {
        detail +=
          " For Resend, set EMAIL_SMTP_USER=resend and EMAIL_SMTP_PASS to your API key.";
      }
      if (h && smtpHostLooksLikeMicrosoft365(h) && (!env("EMAIL_SMTP_USER") || !env("EMAIL_SMTP_PASS"))) {
        detail +=
          " For Microsoft 365, set EMAIL_SMTP_USER and EMAIL_SMTP_PASS to a mailbox that has SMTP AUTH enabled.";
      }
      if (h && smtpHostLooksLikeGmail(h) && (!env("EMAIL_SMTP_USER") || !env("EMAIL_SMTP_PASS"))) {
        detail +=
          " For Gmail, set EMAIL_SMTP_USER to your full Gmail address and EMAIL_SMTP_PASS to a Google App Password.";
      }
      return { ok: false, error: `SMTP is not configured. ${detail}` };
    }

    const transport = createTransport();
    const subject = `Preliminary order #${order.orderNumber} — ${order.customerName}`;
    const csvBody = buildOraclePreliminaryOrderCsv(order, salesRepName, salesRepEmail);
    const csvFilename = preliminaryOrderCsvFilename(order.orderNumber);
    const mode = envAttachmentMode();
    const includeTemplateWorkbook = envBool("ORACLE_ATTACH_TEMPLATE_EMAIL", true);
    const workbookAttachment = includeTemplateWorkbook
      ? buildPrefilledOracleTemplateWorkbook(order)
      : null;
    const maxWorkbookBytes = envNumber("ORACLE_ATTACH_TEMPLATE_MAX_BYTES", 10_000_000);

    const attachments: Array<{
      filename: string;
      content: Buffer;
      contentType: string;
    }> = [];

    if (mode === "csv" || mode === "both") {
      attachments.push({
        filename: csvFilename,
        content: Buffer.from(csvBody, "utf-8"),
        contentType: "text/csv; charset=utf-8",
      });
    }
    if (
      (mode === "xlsm" || mode === "both") &&
      workbookAttachment &&
      workbookAttachment.content.length <= maxWorkbookBytes
    ) {
      attachments.push({
        filename: workbookAttachment.filename,
        content: workbookAttachment.content,
        contentType: "application/vnd.ms-excel.sheet.macroEnabled.12",
      });
    }
    if (attachments.length === 0) {
      // Ensure mail still sends if workbook is missing or above threshold.
      attachments.push({
        filename: csvFilename,
        content: Buffer.from(csvBody, "utf-8"),
        contentType: "text/csv; charset=utf-8",
      });
    }

    // PDF is small (~tens of KB); safe to add alongside .xlsm for most relays.
    if (envBool("EMAIL_ATTACH_PDF", true)) {
      try {
        const pdfBuf = await buildPreliminaryOrderPdf(order);
        attachments.push({
          filename: preliminaryOrderPdfFilename(order.orderNumber),
          content: pdfBuf,
          contentType: "application/pdf",
        });
      } catch {
        // Send email without PDF if generation fails.
      }
    }

    await transport.sendMail({
      from,
      to: salesRepEmail,
      subject,
      text: buildPlainText(order, salesRepName),
      html: buildHtml(order, salesRepName),
      attachments,
    });

    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}
