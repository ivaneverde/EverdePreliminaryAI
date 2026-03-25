"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { CartLine, InventoryItem, PreliminaryOrder } from "@/lib/types";
import { formatMoneyFromCents } from "@/lib/money";

function mergeCart(lines: CartLine[]) {
  const bySku = new Map<string, number>();
  for (const l of lines) bySku.set(l.sku, (bySku.get(l.sku) ?? 0) + l.quantity);
  return Array.from(bySku.entries()).map(([sku, quantity]) => ({ sku, quantity }));
}

export default function Page() {
  const router = useRouter();
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [inventoryLoading, setInventoryLoading] = useState(true);
  const [inventoryError, setInventoryError] = useState<string | null>(null);

  const [inventoryQuery, setInventoryQuery] = useState("");
  const [inventoryFilter, setInventoryFilter] = useState<"all" | "available" | "west" | "central" | "east">(
    "available"
  );
  const [rowQtyInputs, setRowQtyInputs] = useState<Record<string, string>>({});
  const [cartToastMessage, setCartToastMessage] = useState<string | null>(null);
  const cartToastTimerRef = useRef<number | null>(null);
  const [aiMinimized, setAiMinimized] = useState(false);
  const [adminMode, setAdminMode] = useState(false);
  const [adminUnlocked, setAdminUnlocked] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importingInventory, setImportingInventory] = useState(false);
  const [importInventoryMsg, setImportInventoryMsg] = useState<string | null>(null);
  const [importInventoryErr, setImportInventoryErr] = useState<string | null>(null);
  const [cartLines, setCartLines] = useState<CartLine[]>([]);

  const [customerName, setCustomerName] = useState("");
  const [contact, setContact] = useState("");
  const [shipTo, setShipTo] = useState("");
  const [preferredDeliveryDate, setPreferredDeliveryDate] = useState<string>("");
  const [poNumber, setPoNumber] = useState("");

  const [creatingOrder, setCreatingOrder] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createdOrder, setCreatedOrder] = useState<PreliminaryOrder | null>(null);

  const [chatMessages, setChatMessages] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const inventoryBySku = useMemo(() => new Map(inventory.map((i) => [i.sku, i])), [inventory]);

  const cartTotals = useMemo(() => {
    const lineItems = cartLines
      .map((l) => {
        const inv = inventoryBySku.get(l.sku);
        if (!inv) return null;
        return {
          ...l,
          name: inv.name,
          unitPriceCents: inv.priceCents,
          currency: inv.currency,
          lineTotalCents: inv.priceCents * l.quantity,
        };
      })
      .filter(Boolean) as Array<{
      sku: string;
      quantity: number;
      name: string;
      unitPriceCents: number;
      currency: string;
      lineTotalCents: number;
    }>;

    const subTotalCents = lineItems.reduce((sum, li) => sum + li.lineTotalCents, 0);
    return { lineItems, subTotalCents };
  }, [cartLines, inventoryBySku]);

  async function ensureInventoryItemLoaded(sku: string) {
    const trimmed = sku.trim();
    if (!trimmed) return;
    if (inventoryBySku.has(trimmed)) return;
    try {
      const res = await fetch(`/api/inventory?sku=${encodeURIComponent(trimmed)}`);
      if (!res.ok) return;
      const data = await res.json();
      if (!data?.item) return;
      setInventory((prev) => {
        if (prev.some((i) => i.sku === data.item.sku)) return prev;
        return [...prev, data.item];
      });
    } catch {
      // Ignore transient inventory lookup failures; order creation will still validate server-side.
    }
  }

  async function fetchInventoryPage(params: URLSearchParams, attempt = 0): Promise<InventoryItem[]> {
    const url = `/api/inventory?${params.toString()}`;
    try {
      const res = await fetch(url, { method: "GET", cache: "no-store" });
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(`Inventory fetch failed (${res.status}). ${errText.slice(0, 200)}`);
      }
      const data = await res.json();
      return (data.items ?? []) as InventoryItem[];
    } catch (e) {
      if (attempt < 3) {
        await new Promise((r) => window.setTimeout(r, 800 * (attempt + 1)));
        return fetchInventoryPage(params, attempt + 1);
      }
      throw e;
    }
  }

  async function loadInventory() {
    setInventoryLoading(true);
    setInventoryError(null);
    try {
      const pageSize = 250;
      const acc: InventoryItem[] = [];
      let offset = 0;
      while (true) {
        const params = new URLSearchParams();
        if (inventoryQuery.trim()) params.set("q", inventoryQuery.trim());
        params.set("filter", inventoryFilter);
        params.set("limit", String(pageSize));
        params.set("offset", String(offset));

        const batch = await fetchInventoryPage(params);
        acc.push(...batch);
        if (batch.length < pageSize) break;
        offset += pageSize;
        if (offset > 50_000) break;
      }
      setInventory(acc);
    } catch (e) {
      setInventoryError((e as Error).message ?? "Failed to load inventory.");
    } finally {
      setInventoryLoading(false);
    }
  }

  useEffect(() => {
    loadInventory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inventoryFilter]);

  async function addToCart(sku: string, quantity: number) {
    if (quantity <= 0) return;
    setCreatedOrder(null);
    setCreateError(null);

    // Keep cart UX consistent even if AI proposes an item outside the current table filter/limit.
    ensureInventoryItemLoaded(sku);
    setCartLines((prev) => mergeCart([...prev, { sku, quantity }]));

    const plantName = inventoryBySku.get(sku)?.name ?? sku;
    setCartToastMessage(`${plantName} - Qty: ${quantity} added to cart.`);
    if (cartToastTimerRef.current) window.clearTimeout(cartToastTimerRef.current);
    cartToastTimerRef.current = window.setTimeout(() => {
      setCartToastMessage(null);
      cartToastTimerRef.current = null;
    }, 2000);
  }

  function updateCartQty(sku: string, nextQty: number) {
    setCreatedOrder(null);
    setCreateError(null);
    setCartLines((prev) => {
      const q = Math.max(0, Math.floor(nextQty));
      const rest = prev.filter((l) => l.sku !== sku);
      if (q === 0) return rest;
      return [...rest, { sku, quantity: q }];
    });
  }

  async function createOrder() {
    setCreatingOrder(true);
    setCreateError(null);
    setCreatedOrder(null);
    try {
      const payload = {
        customerName: customerName.trim(),
        contact: contact.trim() ? contact.trim() : null,
        shipTo: shipTo.trim(),
        preferredDeliveryDate: preferredDeliveryDate ? preferredDeliveryDate : null,
        poNumber: poNumber.trim() ? poNumber.trim() : null,
        items: cartLines.map((l) => ({ sku: l.sku, quantity: l.quantity })),
      };

      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (!res.ok || !data.ok) {
        throw new Error(data?.error ?? `Order create failed (${res.status}).`);
      }

      setCreatedOrder(data.order);
      setCartLines([]);
      router.push(`/checkout/${data.order.orderNumber}`);
    } catch (e) {
      setCreateError((e as Error).message ?? "Failed to create order.");
    } finally {
      setCreatingOrder(false);
    }
  }

  async function importInventory() {
    if (!importFile) return;
    setImportingInventory(true);
    setImportInventoryErr(null);
    setImportInventoryMsg(null);
    try {
      const form = new FormData();
      form.append("file", importFile);
      const res = await fetch("/api/inventory/import", {
        method: "POST",
        body: form,
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data?.error ?? `Import failed (${res.status}).`);
      }
      setImportInventoryMsg(
        `Imported ${data.totalParsed} rows (${data.created} created, ${data.updated} updated).`
      );
      await new Promise((r) => window.setTimeout(r, 1500));
      await loadInventory();
    } catch (e) {
      setImportInventoryErr((e as Error).message ?? "Inventory import failed.");
    } finally {
      setImportingInventory(false);
    }
  }

  function toggleAdminMode() {
    if (!adminUnlocked) {
      const entered = window.prompt("Enter admin password:");
      if (entered !== "Tyfco") {
        window.alert("Incorrect password.");
        return;
      }
      setAdminUnlocked(true);
      setAdminMode(true);
      return;
    }

    setAdminMode((v) => !v);
  }

  async function sendChat(userText: string) {
    setAiError(null);
    setChatLoading(true);
    try {
      const payload = {
        messages: [
          ...chatMessages.map((m) => ({ role: m.role, content: m.content })),
          { role: "user", content: userText },
        ],
        cart: cartLines,
      };

      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `AI chat failed (${res.status}).`);

      const assistantText: string = data.reply ?? "";
      const additions: Array<{ sku: string; quantity: number }> = data.proposedCartAdditions ?? [];

      setChatMessages((prev) => [
        ...prev,
        { role: "user", content: userText },
        { role: "assistant", content: assistantText },
      ]);

      if (additions.length > 0) {
        // Add proposed items to cart automatically for convenience.
        const lines = additions.map((a) => ({ sku: a.sku, quantity: a.quantity }));
        for (const l of lines) ensureInventoryItemLoaded(l.sku);
        setCartLines((prev) => mergeCart([...prev, ...lines]));
      }
    } catch (e) {
      setAiError((e as Error).message ?? "Failed to send message to AI.");
    } finally {
      setChatLoading(false);
    }
  }

  return (
    <div>
      <header className="topbar">
        <div className="container topbar-inner">
          <div className="row" style={{ gap: 12 }}>
            <img
              src="/api/company-logo"
              alt="Everde logo"
              style={{ width: 74, height: 74, objectFit: "contain", borderRadius: 8 }}
            />
            <div>
              <h1 className="brand-title">Everde AI Assistant</h1>
              <div className="version-label">Version 0.2</div>
              <div className="subtle">Your personal plant-friendly Everde agent and Preliminary Order.</div>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
            <div className="pill pill-brand">Everde Production Testing Mode</div>
            <button
              onClick={toggleAdminMode}
              className="muted-btn"
              style={{ padding: "8px 14px" }}
            >
              {adminMode ? "Hide Admin" : "Admin"}
            </button>
          </div>
        </div>
      </header>

      <div className="container">
        <div className="content-wrap">
      <div className="grid">
        <div className="panel">
          <div className="title">Inventory</div>

          <div className="row" style={{ marginBottom: 12 }}>
            <div style={{ flex: 1 }}>
              <input
                value={inventoryQuery}
                onChange={(e) => setInventoryQuery(e.target.value)}
                placeholder="Search by SKU, name, or quality..."
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    loadInventory();
                  }
                }}
              />
            </div>
            <select
              style={{ width: 180 }}
              value={inventoryFilter}
              onChange={(e) =>
                setInventoryFilter(
                  e.target.value as "all" | "available" | "west" | "central" | "east"
                )
              }
            >
              <option value="all">All</option>
              <option value="available">Available only</option>
              <option value="west">West</option>
              <option value="central">Central</option>
              <option value="east">East</option>
            </select>
          </div>

          {adminMode ? (
            <>
              <div className="row" style={{ marginBottom: 10 }}>
                <input
                  type="file"
                  accept=".xls,.xlsx,.html"
                  onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
                />
                <button className="primary" disabled={!importFile || importingInventory} onClick={importInventory}>
                  {importingInventory ? "Importing..." : "Import Inventory"}
                </button>
              </div>
              {importInventoryMsg ? <div className="toast toast-success">{importInventoryMsg}</div> : null}
              {importInventoryErr ? <div className="toast toast-error">{importInventoryErr}</div> : null}
            </>
          ) : null}

          <div className="subtle" style={{ marginBottom: 10 }}>
            {inventoryLoading ? "Loading inventory..." : `${inventory.length} items`}
          </div>
          {inventoryError ? <div className="toast toast-error">{inventoryError}</div> : null}

          <div style={{ maxHeight: 700, overflow: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>SKU</th>
                  <th>View</th>
                  <th>Specs</th>
                  <th>Available</th>
                  <th>Price</th>
                  <th>Add</th>
                </tr>
              </thead>
              <tbody>
                {inventory.map((item) => {
                  const inCart = cartLines.find((c) => c.sku === item.sku)?.quantity ?? 0;
                  return (
                    <tr key={item.sku}>
                      <td style={{ width: 260 }}>{item.name}</td>
                      <td style={{ width: 120 }}>{item.sku}</td>
                      <td style={{ width: 130 }}>
                        {item.viewPlantUrl ? (
                          <a href={item.viewPlantUrl} target="_blank" rel="noopener noreferrer">
                            View Plant
                          </a>
                        ) : (
                          <span className="subtle">-</span>
                        )}
                      </td>
                      <td style={{ width: 160 }}>{item.quality ?? <span className="subtle">-</span>}</td>
                      <td style={{ width: 120 }}>
                        {item.availabilityQty > 0 ? (
                          <span className="pill"><strong>{item.availabilityQty}</strong></span>
                        ) : (
                          <span className="pill" style={{ borderColor: "rgba(255,107,107,0.5)", color: "#ffb3b3" }}>
                            Out
                          </span>
                        )}
                      </td>
                      <td style={{ width: 140 }}>
                        {formatMoneyFromCents(item.priceCents, item.currency)}
                      </td>
                      <td style={{ width: 160 }}>
                        <div className="row" style={{ gap: 8 }}>
                          <button
                            className="muted-btn"
                            onClick={() => addToCart(item.sku, 1)}
                            disabled={item.availabilityQty <= 0}
                            style={{ padding: "8px 10px", whiteSpace: "nowrap" }}
                          >
                            Add 1
                          </button>
                          <input
                            type="number"
                            min={1}
                            step={1}
                            value={rowQtyInputs[item.sku] ?? ""}
                            onChange={(e) =>
                              setRowQtyInputs((prev) => ({
                                ...prev,
                                [item.sku]: e.target.value,
                              }))
                            }
                            onKeyDown={(e) => {
                              if (e.key !== "Enter") return;
                              e.preventDefault();
                              const raw = rowQtyInputs[item.sku] ?? "";
                              const qty = Math.max(1, Math.floor(Number(raw)));
                              if (!Number.isFinite(qty)) return;
                              addToCart(item.sku, qty);
                              setRowQtyInputs((prev) => ({
                                ...prev,
                                [item.sku]: "",
                              }));
                            }}
                            placeholder="Qty"
                            style={{ width: 78, padding: "8px 10px" }}
                          />
                          <span className="subtle" style={{ whiteSpace: "nowrap" }}>
                            in cart: {inCart}
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {inventory.length === 0 && !inventoryLoading ? (
                  <tr>
                    <td colSpan={7} className="subtle">
                      No items found. Import inventory later from your Excel.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <div className="subtle" style={{ marginTop: 10 }}>
            Tip: Ask the AI assistant for recommendations, then review your cart and shipping details.
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="panel ai-sticky">
            <div className="row-between" style={{ marginBottom: 10 }}>
              <div className="title" style={{ margin: 0 }}>
                AI Assistant
              </div>
              <button
                className="muted-btn"
                onClick={() => setAiMinimized((v) => !v)}
                style={{ padding: "6px 12px" }}
              >
                {aiMinimized ? "Maximize" : "Minimize"}
              </button>
            </div>
            {!aiMinimized ? (
              <>
                <div className="subtle" style={{ marginBottom: 10 }}>
                  Ask for recommendations, availability, quality, or pricing. The assistant can propose cart items.
                </div>

                <AiChat
                  messages={chatMessages}
                  onSend={sendChat}
                  loading={chatLoading}
                  error={aiError}
                />
              </>
            ) : (
              <div className="subtle">Assistant minimized. Click Maximize to continue chatting.</div>
            )}
          </div>

          <div className="panel">
            <div className="title">Cart</div>

            {cartTotals.lineItems.length === 0 ? (
              <div className="subtle">Cart is empty. Add items from the inventory list or from AI suggestions.</div>
            ) : (
              <div style={{ maxHeight: 220, overflow: "auto" }}>
                <table>
                  <thead>
                    <tr>
                      <th>SKU</th>
                      <th>Qty</th>
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cartTotals.lineItems.map((li) => (
                      <tr key={li.sku}>
                        <td style={{ width: 110 }}>{li.sku}</td>
                        <td style={{ width: 140 }}>
                          <div className="row" style={{ gap: 8 }}>
                            <button
                              className="muted-btn"
                              style={{ padding: "8px 10px" }}
                              onClick={() => updateCartQty(li.sku, li.quantity - 1)}
                            >
                              -
                            </button>
                            <div style={{ width: 54, textAlign: "center" }}>
                              <strong>{li.quantity}</strong>
                            </div>
                            <button
                              className="muted-btn"
                              style={{ padding: "8px 10px" }}
                              onClick={() => updateCartQty(li.sku, li.quantity + 1)}
                            >
                              +
                            </button>
                          </div>
                        </td>
                        <td style={{ width: 160 }}>{formatMoneyFromCents(li.lineTotalCents, li.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="row-between" style={{ marginTop: 10 }}>
              <div className="subtle">Subtotal</div>
              <div style={{ fontWeight: 800 }}>
                {formatMoneyFromCents(
                  cartTotals.subTotalCents,
                  cartTotals.lineItems[0]?.currency ?? "USD"
                )}
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="title">Shipping Details</div>

            <div className="row" style={{ marginBottom: 10 }}>
              <div style={{ flex: 1 }}>
                <div className="subtle" style={{ marginBottom: 6 }}>
                  Customer name
                </div>
                <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="e.g., The Landscape Company Co" />
              </div>
            </div>

            <div className="row" style={{ marginBottom: 10 }}>
              <div style={{ flex: 1 }}>
                <div className="subtle" style={{ marginBottom: 6 }}>
                  Contact
                </div>
                <input
                  value={contact}
                  onChange={(e) => setContact(e.target.value)}
                  placeholder="Phone or email"
                  type="text"
                  autoComplete="tel"
                />
              </div>
            </div>

            <div className="row" style={{ marginBottom: 10 }}>
              <div style={{ flex: 1 }}>
                <div className="subtle" style={{ marginBottom: 6 }}>
                  Ship to delivery location
                </div>
                <input value={shipTo} onChange={(e) => setShipTo(e.target.value)} placeholder="Street, City, State" />
              </div>
            </div>

            <div className="row" style={{ marginBottom: 10 }}>
              <div style={{ flex: 1 }}>
                <div className="subtle" style={{ marginBottom: 6 }}>
                  Preferred delivery date (optional)
                </div>
                <input type="date" value={preferredDeliveryDate} onChange={(e) => setPreferredDeliveryDate(e.target.value)} />
              </div>
            </div>

            <div className="row" style={{ marginBottom: 10 }}>
              <div style={{ flex: 1 }}>
                <div className="subtle" style={{ marginBottom: 6 }}>
                  PO number (optional). If blank, we auto-create.
                </div>
                <input value={poNumber} onChange={(e) => setPoNumber(e.target.value)} placeholder="e.g., PO-12345" />
              </div>
            </div>

            {createError ? <div className="toast toast-error">{createError}</div> : null}

            <button
              className="primary"
              onClick={createOrder}
              disabled={
                creatingOrder ||
                cartLines.length === 0 ||
                !customerName.trim() ||
                !contact.trim() ||
                !shipTo.trim()
              }
              style={{ width: "100%" }}
            >
              {creatingOrder ? "Creating..." : "Create Preliminary Order"}
            </button>

            {createdOrder ? (
              <div className="toast toast-success" style={{ marginTop: 12 }}>
                Preliminary order created. Order number: <strong>{createdOrder.orderNumber}</strong>
                <div className="subtle" style={{ marginTop: 6 }}>
                  Status: {createdOrder.status} • {createdOrder.lines.length} line(s) • PO: {createdOrder.poNumber ?? "AUTO"}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
      </div>
      {cartToastMessage ? <div className="cart-toast">{cartToastMessage}</div> : null}
      </div>
    </div>
  );
}

function AiChat(props: {
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  onSend: (text: string) => Promise<void>;
  loading: boolean;
  error: string | null;
}) {
  const [text, setText] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [props.messages, props.loading]);

  return (
    <div>
      <div ref={scrollRef} style={{ maxHeight: 440, overflow: "auto", paddingRight: 6 }}>
        {props.messages.length === 0 ? (
          <div className="subtle">No chat yet. Try: "I'm new - what plants do you recommend for low light?"</div>
        ) : (
          props.messages.map((m, idx) => (
            <div key={idx} style={{ marginBottom: 10 }}>
              <div
                style={{
                  fontWeight: 700,
                  color: m.role === "assistant" ? "var(--brand-strong)" : "var(--text)",
                }}
              >
                {m.role === "assistant" ? "Assistant" : "You"}
              </div>
              <div className="subtle" style={{ whiteSpace: "pre-wrap" }}>
                <MessageText text={m.content} />
              </div>
            </div>
          ))
        )}
      </div>

      {props.error ? <div className="toast toast-error">{props.error}</div> : null}

      <div className="row" style={{ marginTop: 10 }}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type your message..."
          disabled={props.loading}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const v = text.trim();
              if (!v) return;
              props.onSend(v);
              setText("");
            }
          }}
        />
        <button
          className="primary"
          onClick={() => {
            const v = text.trim();
            if (!v) return;
            props.onSend(v);
            setText("");
          }}
          disabled={props.loading || !text.trim()}
          style={{ width: 150 }}
        >
          {props.loading ? "Thinking..." : "Send"}
        </button>
      </div>
    </div>
  );
}

function MessageText({ text }: { text: string }) {
  const markdownLinkPattern = /!?\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  const lines = text.split("\n");

  return (
    <>
      {lines.map((line, idx) => (
        <div key={idx}>
          {renderLineWithLinks(line, markdownLinkPattern)}
        </div>
      ))}
    </>
  );
}

function renderLineWithLinks(line: string, pattern: RegExp) {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  pattern.lastIndex = 0;

  while ((match = pattern.exec(line)) !== null) {
    const [full, label, url] = match;
    const start = match.index;
    if (start > lastIndex) {
      parts.push(line.slice(lastIndex, start));
    }
    parts.push(
      <a key={`${url}-${start}`} href={url} target="_blank" rel="noopener noreferrer">
        {label}
      </a>
    );
    lastIndex = start + full.length;
  }

  if (lastIndex < line.length) {
    parts.push(line.slice(lastIndex));
  }

  return parts.length > 0 ? parts : line;
}

