"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  orderNumber: number;
  initialSalesRepName: string | null;
  initialSalesRepEmail: string | null;
};

export function CheckoutSalesRepForm({
  orderNumber,
  initialSalesRepName,
  initialSalesRepEmail,
}: Props) {
  const router = useRouter();
  const [name, setName] = useState(initialSalesRepName ?? "");
  const [email, setEmail] = useState(initialSalesRepEmail ?? "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<null | { type: "ok" | "err"; text: string }>(null);

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/orders/${orderNumber}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ salesRepName: name, salesRepEmail: email }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        salesRepName?: string | null;
        salesRepEmail?: string | null;
        emailSent?: boolean;
        emailError?: string;
      };
      if (!res.ok || !data.ok) {
        setMessage({
          type: "err",
          text: typeof data.error === "string" ? data.error : "Could not save. Try again.",
        });
        return;
      }
      setName(data.salesRepName ?? "");
      setEmail(data.salesRepEmail ?? "");
      if (data.emailSent) {
        setMessage({
          type: "ok",
          text: `Saved. A copy was emailed to ${data.salesRepEmail ?? email}.`,
        });
      } else if (data.emailError) {
        setMessage({ type: "err", text: data.emailError });
      } else if (!(data.salesRepEmail ?? "").trim()) {
        setMessage({
          type: "ok",
          text: "Saved. Add the sales rep’s email and save again to send a copy.",
        });
      } else {
        setMessage({ type: "ok", text: "Saved." });
      }
      router.refresh();
    } catch {
      setMessage({ type: "err", text: "Network error. Try again." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="panel" style={{ marginBottom: 14 }}>
      <div className="title">Sales representative</div>
      <p className="subtle" style={{ marginBottom: 10 }}>
        Enter your sales representative&apos;s name and work email. When you save, a copy of this preliminary
        order is sent from the configured Everde mailbox (SMTP).
      </p>
      <label className="subtle" style={{ display: "block", marginBottom: 6, fontWeight: 600 }}>
        Sales rep name
      </label>
      <input
        type="text"
        placeholder="e.g. Jane Smith"
        value={name}
        onChange={(e) => setName(e.target.value)}
        disabled={saving}
        style={{ width: "100%", maxWidth: 420, marginBottom: 10 }}
        autoComplete="name"
      />
      <label className="subtle" style={{ display: "block", marginBottom: 6, fontWeight: 600 }}>
        Sales rep email (Outlook)
      </label>
      <input
        type="email"
        placeholder="e.g. jane.smith@everde.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        disabled={saving}
        style={{ width: "100%", maxWidth: 420, marginBottom: 10 }}
        autoComplete="email"
      />
      <div className="row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" className="pill pill-brand" onClick={() => void save()} disabled={saving}>
          {saving ? "Sending…" : "Send"}
        </button>
        {message ? (
          <span
            className="subtle"
            style={{
              color: message.type === "ok" ? "var(--ok, #0a7)" : "var(--err, #b33)",
              fontWeight: 600,
            }}
          >
            {message.text}
          </span>
        ) : null}
      </div>
    </div>
  );
}
