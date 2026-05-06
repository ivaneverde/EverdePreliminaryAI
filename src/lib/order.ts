import { z } from "zod";
import { prisma } from "./prisma";

const PreliminaryOrderLineInputSchema = z.object({
  sku: z.string().min(1),
  quantity: z.number().int().positive(),
});

export const PreliminaryOrderInputSchema = z.object({
  customerName: z.string().min(1),
  contact: z.string().optional().nullable(),
  specialInstructions: z.string().max(4000).optional().nullable(),
  shipTo: z.string().min(1),
  preferredDeliveryDate: z
    .string()
    .optional()
    .nullable()
    .transform((v) => (v ? new Date(v) : null)),
  poNumber: z.string().min(1).optional().nullable(),
  items: z.array(PreliminaryOrderLineInputSchema).min(1).max(100),
});

export type PreliminaryOrderInput = z.infer<typeof PreliminaryOrderInputSchema>;

export async function createPreliminaryOrder(input: unknown) {
  const parsed = PreliminaryOrderInputSchema.parse(input);

  const skus = parsed.items.map((i) => i.sku);
  const items = await prisma.inventoryItem.findMany({
    where: { sku: { in: skus } },
    select: { sku: true, name: true, availabilityQty: true, priceCents: true, currency: true },
  });

  const bySku = new Map(items.map((i) => [i.sku, i]));
  const unknownSkus = parsed.items.filter((i) => !bySku.has(i.sku));
  if (unknownSkus.length > 0) {
    return { ok: false as const, error: `Unknown item SKUs: ${unknownSkus.map((s) => s.sku).join(", ")}` };
  }

  const insufficient = parsed.items.filter((i) => {
    const inv = bySku.get(i.sku)!;
    return i.quantity > inv.availabilityQty;
  });

  if (insufficient.length > 0) {
    const msg = insufficient
      .map((i) => {
        const inv = bySku.get(i.sku)!;
        return `${i.sku} (requested ${i.quantity}, available ${inv.availabilityQty})`;
      })
      .join("; ");
    return { ok: false as const, error: `Insufficient availability: ${msg}` };
  }

  const maxOrder = await prisma.preliminaryOrder.aggregate({
    _max: { orderNumber: true },
  });
  const nextOrderNumber = (maxOrder._max.orderNumber ?? 0) + 1;

  const poNumber =
    parsed.poNumber && parsed.poNumber.trim().length > 0
      ? parsed.poNumber.trim()
      : `AUTO-PO-${nextOrderNumber}`;

  const contact =
    parsed.contact && typeof parsed.contact === "string" && parsed.contact.trim().length > 0
      ? parsed.contact.trim()
      : null;
  const specialInstructions =
    parsed.specialInstructions &&
    typeof parsed.specialInstructions === "string" &&
    parsed.specialInstructions.trim().length > 0
      ? parsed.specialInstructions.trim()
      : null;

  // Do not pass orderNumber into create(): with @id @default(autoincrement()) Prisma assigns it.
  // We still use nextOrderNumber above for AUTO-PO-* (matches DB in normal single-writer use).
  const created = await prisma.preliminaryOrder.create({
    data: {
      customerName: parsed.customerName,
      contact,
      specialInstructions,
      shipTo: parsed.shipTo,
      preferredDeliveryDate: parsed.preferredDeliveryDate ?? undefined,
      poNumber,
      status: "PRELIMINARY",
      lines: {
        create: parsed.items.map((i) => {
          const inv = bySku.get(i.sku)!;
          const unit = inv.priceCents;
          return {
            itemName: inv.name,
            unitPriceCents: unit,
            quantity: i.quantity,
            lineTotalCents: unit * i.quantity,
            inventoryItem: { connect: { sku: inv.sku } },
          };
        }),
      },
    },
    include: {
      lines: true,
    },
  });

  return {
    ok: true as const,
    order: {
      id: created.orderNumber,
      orderNumber: created.orderNumber,
      status: created.status,
      createdAt: created.createdAt.toISOString(),
      customerName: created.customerName,
      contact: created.contact,
      specialInstructions: created.specialInstructions,
      shipTo: created.shipTo,
      preferredDeliveryDate: created.preferredDeliveryDate
        ? created.preferredDeliveryDate.toISOString().slice(0, 10)
        : null,
      poNumber: created.poNumber,
      lines: created.lines.map((l) => ({
        id: l.id,
        sku: l.sku,
        itemName: l.itemName,
        quantity: l.quantity,
        unitPriceCents: l.unitPriceCents,
        lineTotalCents: l.lineTotalCents,
      })),
    },
  };
}

