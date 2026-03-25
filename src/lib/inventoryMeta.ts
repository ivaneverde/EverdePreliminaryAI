import { promises as fs } from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const INVENTORY_META_PATH = path.join(DATA_DIR, "inventory-meta.json");

export type InventoryMeta = {
  viewPlantUrl?: string;
  farmCode?: string;
};

export type InventoryMetaMap = Record<string, InventoryMeta>;

export async function readInventoryMetaMap(): Promise<InventoryMetaMap> {
  try {
    const raw = await fs.readFile(INVENTORY_META_PATH, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: InventoryMetaMap = {};
    for (const [sku, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof sku !== "string" || !value || typeof value !== "object") continue;
      const v = value as Record<string, unknown>;
      out[sku] = {
        viewPlantUrl: typeof v.viewPlantUrl === "string" ? v.viewPlantUrl.trim() : undefined,
        farmCode: typeof v.farmCode === "string" ? v.farmCode.trim().toUpperCase() : undefined,
      };
    }
    return out;
  } catch {
    return {};
  }
}

export async function writeInventoryMetaMap(map: InventoryMetaMap) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(INVENTORY_META_PATH, JSON.stringify(map, null, 2), "utf8");
}

