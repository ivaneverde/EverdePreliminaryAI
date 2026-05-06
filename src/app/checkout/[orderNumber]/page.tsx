import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { formatMoneyFromCents } from "@/lib/money";
import { CheckoutSalesRepForm } from "./CheckoutSalesRepForm";

export default async function CheckoutSummaryPage({
  params,
}: {
  params: { orderNumber: string };
}) {
  const orderNumber = Number(params.orderNumber);
  if (!Number.isInteger(orderNumber) || orderNumber <= 0) {
    notFound();
  }

  const order = await prisma.preliminaryOrder.findUnique({
    where: { orderNumber },
    include: {
      lines: {
        orderBy: { id: "asc" },
      },
    },
  });

  if (!order) {
    notFound();
  }

  const totalCents = order.lines.reduce((sum, l) => sum + l.lineTotalCents, 0);

  return (
    <div className="container">
      <div className="panel" style={{ maxWidth: 980, margin: "20px auto" }}>
        <div className="row-between" style={{ marginBottom: 12 }}>
          <h1 className="brand-title" style={{ fontSize: 24 }}>
            Preliminary Order Checkout
          </h1>
          <div className="pill pill-brand">Order #{order.orderNumber}</div>
        </div>

        <div className="subtle" style={{ marginBottom: 16 }}>
          Review your preliminary order details below.
        </div>

        <div className="panel" style={{ marginBottom: 14 }}>
          <div className="title">Order Information</div>
          <div className="subtle">Customer: {order.customerName}</div>
          <div className="subtle">
            Contact: {order.contact?.trim() ? order.contact : "Not provided"}
          </div>
          <div className="subtle">Ship To: {order.shipTo}</div>
          <div className="subtle">
            Preferred Delivery Date:{" "}
            {order.preferredDeliveryDate
              ? order.preferredDeliveryDate.toISOString().slice(0, 10)
              : "Not provided"}
          </div>
          <div className="subtle">PO Number: {order.poNumber ?? "AUTO"}</div>
          <div className="subtle">
            Special Instructions / Jobsite Notes: {order.specialInstructions?.trim() ? order.specialInstructions : "Not provided"}
          </div>
          <div className="subtle">Status: {order.status}</div>
          <div className="subtle">
            Sales rep (for email copy):{" "}
            {order.salesRepName?.trim() ? order.salesRepName : "Not provided yet"}
          </div>
          <div className="subtle">
            Sales rep email:{" "}
            {order.salesRepEmail?.trim() ? order.salesRepEmail : "Not provided yet"}
          </div>
        </div>

        <div className="panel" style={{ marginBottom: 14 }}>
          <div className="title">Items</div>
          <table>
            <thead>
              <tr>
                <th>SKU</th>
                <th>Item</th>
                <th>Qty</th>
                <th>Unit Price</th>
                <th>Line Total</th>
              </tr>
            </thead>
            <tbody>
              {order.lines.map((line) => (
                <tr key={line.id}>
                  <td>{line.sku}</td>
                  <td>{line.itemName}</td>
                  <td>{line.quantity}</td>
                  <td>{formatMoneyFromCents(line.unitPriceCents, "USD")}</td>
                  <td>{formatMoneyFromCents(line.lineTotalCents, "USD")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="row-between" style={{ marginBottom: 18 }}>
          <div className="title" style={{ margin: 0 }}>
            Total
          </div>
          <div style={{ fontWeight: 800, fontSize: 20 }}>
            {formatMoneyFromCents(totalCents, "USD")}
          </div>
        </div>

        <CheckoutSalesRepForm
          orderNumber={order.orderNumber}
          initialSalesRepName={order.salesRepName}
          initialSalesRepEmail={order.salesRepEmail}
        />

        <div className="row" style={{ justifyContent: "flex-start", marginBottom: 14 }}>
          <a href={`/api/orders/${order.orderNumber}/export?format=csv`} className="pill" download>
            Download CSV
          </a>
          <a href={`/api/orders/${order.orderNumber}/export?format=pdf`} className="pill" download>
            Download PDF
          </a>
        </div>

        <div className="row" style={{ justifyContent: "flex-end" }}>
          <Link href="/" className="pill">
            Back to Inventory
          </Link>
        </div>
      </div>
    </div>
  );
}

