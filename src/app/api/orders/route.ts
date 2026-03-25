import { NextResponse } from "next/server";
import { createPreliminaryOrder } from "@/lib/order";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const result = await createPreliminaryOrder(body);

    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    }

    return NextResponse.json({ ok: true, order: result.order });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message ?? "Failed to create order." },
      { status: 500 }
    );
  }
}

