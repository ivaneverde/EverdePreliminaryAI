import { promises as fs } from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const VIEW_LINKS_PATH = path.join(DATA_DIR, "view-plant-links.json");

export type ViewLinksMap = Record<string, string>;

export async function readViewLinksMap(): Promise<ViewLinksMap> {
  try {
    const raw = await fs.readFile(VIEW_LINKS_PATH, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: ViewLinksMap = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof k === "string" && typeof v === "string" && v.trim()) out[k] = v.trim();
    }
    return out;
  } catch {
    return {};
  }
}

export async function writeViewLinksMap(map: ViewLinksMap) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(VIEW_LINKS_PATH, JSON.stringify(map, null, 2), "utf8");
}

