import { NextResponse } from "next/server";
import { buildEcePpoiDat, ecePpoiDatFilename } from "@/lib/ecePpoiDat";
import { buildPreliminaryOrderPdf, preliminaryOrderPdfFilename } from "@/lib/orderPdf";
import {
  buildOraclePreliminaryOrderCsv,
  preliminaryOrderCsvFilename,
} from "@/lib/oracleOrderCsv";
import { prisma } from "@/lib/prisma";
import { buildWebAdiFriendlyCsv, webAdiCsvFilename } from "@/lib/webAdiOrderCsv";

export async function GET(
  req: Request,
  { params }: { params: { orderNumber: string } }
) {
  const orderNumber = Number(params.orderNumber);
  if (!Number.isInteger(orderNumber) || orderNumber <= 0) {
    return NextResponse.json({ error: "Invalid order number." }, { status: 400 });
  }

  const { searchParams } = new URL(req.url);
  const format = (searchParams.get("format") ?? "webadi").toLowerCase();

  const order = await prisma.preliminaryOrder.findUnique({
    where: { orderNumber },
    include: { lines: { orderBy: { id: "asc" } } },
  });

  if (!order) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }

  if (format === "dat") {
    const body = buildEcePpoiDat(order);
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${ecePpoiDatFilename(order.orderNumber)}"`,
        "Cache-Control": "no-store",
      },
    });
  }

  if (format === "csv") {
    const body = buildOraclePreliminaryOrderCsv(
      order,
      order.salesRepName,
      order.salesRepEmail
    );
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${preliminaryOrderCsvFilename(order.orderNumber)}"`,
        "Cache-Control": "no-store",
      },
    });
  }

  if (format === "webadi") {
    const body = buildWebAdiFriendlyCsv(order);
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${webAdiCsvFilename(order.orderNumber)}"`,
        "Cache-Control": "no-store",
      },
    });
  }

  if (format === "pdf") {
    const body = await buildPreliminaryOrderPdf(order);
    return new NextResponse(new Uint8Array(body), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${preliminaryOrderPdfFilename(order.orderNumber)}"`,
        "Cache-Control": "no-store",
      },
    });
  }

  return NextResponse.json(
    { error: "Unknown format. Use webadi, csv, dat, or pdf." },
    { status: 400 }
  );
}
