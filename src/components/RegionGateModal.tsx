"use client";

import { useState } from "react";

export type GateRegion = "west" | "central" | "east";

type Props = {
  open: boolean;
  onSelect: (region: GateRegion) => void;
};

/** Simplified contiguous US + AK/HI as three clickable zones (approximate geography for UX). */
export function RegionGateModal({ open, onSelect }: Props) {
  const [hover, setHover] = useState<GateRegion | null>(null);

  if (!open) return null;

  const fill = (r: GateRegion) => {
    const active = hover === r;
    return active ? "var(--brand)" : "var(--brand-soft)";
  };

  const opacity = (r: GateRegion) => (hover === r ? 0.55 : 0.28);

  return (
    <div className="region-gate-backdrop" role="dialog" aria-modal="true" aria-labelledby="region-gate-title">
      <div className="region-gate-card">
        <img
          src="/api/company-logo"
          alt="Everde"
          className="region-gate-logo"
          width={120}
          height={120}
          style={{ objectFit: "contain" }}
        />
        <h2 id="region-gate-title" className="region-gate-heading">
          Choose your selling region
        </h2>
        <p className="subtle region-gate-sub">
          Hover a zone, then click. Inventory will show availability for that region only until you change it.
        </p>

        <div className="region-gate-map-wrap">
          <svg viewBox="0 0 1000 620" className="region-gate-svg" aria-hidden>
            {/* Lower 48 outline (decorative) */}
            <path
              d="M 38 95 L 95 82 L 155 88 L 220 75 L 295 68 L 385 62 L 485 58 L 585 55 L 685 58 L 785 65 L 875 78 L 948 95 L 968 145 L 958 220 L 952 310 L 948 395 L 942 485 L 928 545 L 858 568 L 758 578 L 648 582 L 528 585 L 408 582 L 288 575 L 168 558 L 78 528 L 42 458 L 32 365 L 35 255 Z"
              fill="none"
              stroke="var(--border)"
              strokeWidth={2.5}
              strokeLinejoin="round"
            />

            <path
              d="M 45 100 L 285 88 L 305 195 L 275 520 L 58 535 L 38 280 Z"
              fill={fill("west")}
              fillOpacity={opacity("west")}
              stroke="var(--brand-strong)"
              strokeWidth={hover === "west" ? 2.5 : 1.5}
              className="region-gate-hit"
              onMouseEnter={() => setHover("west")}
              onMouseLeave={() => setHover(null)}
              onClick={() => onSelect("west")}
            />
            <path
              d="M 285 88 L 518 82 L 538 210 L 512 528 L 275 520 L 305 195 Z"
              fill={fill("central")}
              fillOpacity={opacity("central")}
              stroke="var(--brand-strong)"
              strokeWidth={hover === "central" ? 2.5 : 1.5}
              className="region-gate-hit"
              onMouseEnter={() => setHover("central")}
              onMouseLeave={() => setHover(null)}
              onClick={() => onSelect("central")}
            />
            <path
              d="M 518 82 L 935 95 L 955 265 L 928 538 L 512 528 L 538 210 Z"
              fill={fill("east")}
              fillOpacity={opacity("east")}
              stroke="var(--brand-strong)"
              strokeWidth={hover === "east" ? 2.5 : 1.5}
              className="region-gate-hit"
              onMouseEnter={() => setHover("east")}
              onMouseLeave={() => setHover(null)}
              onClick={() => onSelect("east")}
            />

            {/* Alaska + Hawaii → West */}
            <path
              d="M 52 540 L 168 532 L 178 598 L 48 608 Z M 195 565 L 248 558 L 255 592 L 192 598 Z M 218 548 L 268 542 L 275 572 L 212 578 Z"
              fill={fill("west")}
              fillOpacity={opacity("west")}
              stroke="var(--brand-strong)"
              strokeWidth={hover === "west" ? 2.5 : 1.5}
              className="region-gate-hit"
              onMouseEnter={() => setHover("west")}
              onMouseLeave={() => setHover(null)}
              onClick={() => onSelect("west")}
            />

            <text x={165} y={320} textAnchor="middle" className="region-gate-svg-label">
              West
            </text>
            <text x={400} y={320} textAnchor="middle" className="region-gate-svg-label">
              Central
            </text>
            <text x={720} y={320} textAnchor="middle" className="region-gate-svg-label">
              East
            </text>
          </svg>
        </div>

        <div className="region-gate-legend subtle">
          <span>
            <strong>West</strong> Pacific / Mountain
          </span>
          <span>
            <strong>Central</strong> Plains / Midwest
          </span>
          <span>
            <strong>East</strong> Atlantic / Southeast
          </span>
        </div>
      </div>
    </div>
  );
}
