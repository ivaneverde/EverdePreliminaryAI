"use client";

export type GateRegion = "west" | "central" | "east";

type Props = {
  open: boolean;
  onSelect: (region: GateRegion) => void;
};

export function RegionGateModal({ open, onSelect }: Props) {
  if (!open) return null;

  return (
    <div className="region-gate-backdrop" role="dialog" aria-modal="true" aria-labelledby="region-gate-title">
      <div className="region-gate-card">
        <img
          src="/api/company-logo"
          alt="Everde"
          className="region-gate-logo"
          width={96}
          height={96}
          style={{ objectFit: "contain" }}
        />
        <h2 id="region-gate-title" className="region-gate-heading">
          Choose Region
        </h2>

        <div className="region-gate-map-wrap">
          <img src="/maps/us-region-map.png" alt="" className="region-gate-map-image" aria-hidden="true" />
          <button
            type="button"
            className="region-gate-zone region-gate-zone-west"
            aria-label="Choose West region"
            onClick={() => onSelect("west")}
          />
          <button
            type="button"
            className="region-gate-zone region-gate-zone-central"
            aria-label="Choose Central region"
            onClick={() => onSelect("central")}
          />
          <button
            type="button"
            className="region-gate-zone region-gate-zone-east"
            aria-label="Choose East region"
            onClick={() => onSelect("east")}
          />
        </div>

        <div className="region-gate-actions" aria-label="Region choices">
          <button type="button" className="region-gate-action" onClick={() => onSelect("west")}>
            West
          </button>
          <button type="button" className="region-gate-action" onClick={() => onSelect("central")}>
            Central
          </button>
          <button type="button" className="region-gate-action" onClick={() => onSelect("east")}>
            East
          </button>
        </div>
      </div>
    </div>
  );
}
