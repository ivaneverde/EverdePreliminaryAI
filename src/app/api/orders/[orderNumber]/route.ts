import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  isSmtpConfigured,
  sendPreliminaryOrderEmailToSalesRep,
} from "@/lib/emailOrder";

const trimNameOrNull = z.union([z.string(), z.null()]).transform((v) => {
  if (v == null) return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
});

const trimEmailOrNull = z.union([z.string(), z.null()]).transform((v) => {
  if (v == null) return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
});

const PatchBodySchema = z
  .object({
    salesRepName: trimNameOrNull,
    salesRepEmail: trimEmailOrNull,
  })
  .superRefine((data, ctx) => {
    if (
      data.salesRepEmail !== null &&
      !z.string().email().safeParse(data.salesRepEmail).success
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["salesRepEmail"],
        message: "Invalid email address",
      });
    }
  });

export async function PATCH(
  req: Request,
  { params }: { params: { orderNumber: string } }
) {
  const orderNumber = Number(params.orderNumber);
  if (!Number.isInteger(orderNumber) || orderNumber <= 0) {
    return NextResponse.json({ ok: false, error: "Invalid order number." }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = PatchBodySchema.safeParse(body);
  if (!parsed.success) {
    const emailErr = parsed.error.flatten().fieldErrors.salesRepEmail?.[0];
    return NextResponse.json(
      { ok: false, error: emailErr ?? "Invalid request body." },
      { status: 400 }
    );
  }

  const exists = await prisma.preliminaryOrder.findUnique({
    where: { orderNumber },
    select: { orderNumber: true },
  });
  if (!exists) {
    return NextResponse.json({ ok: false, error: "Order not found." }, { status: 404 });
  }

  const updated = await prisma.preliminaryOrder.update({
    where: { orderNumber },
    data: {
      salesRepName: parsed.data.salesRepName,
      salesRepEmail: parsed.data.salesRepEmail,
    },
    select: { salesRepName: true, salesRepEmail: true },
  });

  let emailSent = false;
  let emailError: string | undefined;

  if (updated.salesRepEmail) {
    if (!isSmtpConfigured()) {
      emailError = "Saved, but email was not sent: SMTP is not configured on the server.";
    } else {
      const orderWithLines = await prisma.preliminaryOrder.findUnique({
        where: { orderNumber },
        include: { lines: { orderBy: { id: "asc" } } },
      });
      if (orderWithLines) {
        const send = await sendPreliminaryOrderEmailToSalesRep(
          orderWithLines,
          updated.salesRepEmail,
          updated.salesRepName
        );
        if (send.ok) {
          emailSent = true;
        } else {
          emailError = `Saved, but email failed: ${send.error}`;
        }
      }
    }
  }

  return NextResponse.json({
    ok: true,
    salesRepName: updated.salesRepName,
    salesRepEmail: updated.salesRepEmail,
    emailSent,
    emailError,
  });
}
