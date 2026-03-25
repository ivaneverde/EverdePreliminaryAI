import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Absolute path to the company logo PNG (PDF + /api/company-logo), or null if missing.
 * Set COMPANY_LOGO_PATH to override; otherwise uses public/company-logo.png at repo root.
 */
export function resolveCompanyLogoPath(): string | null {
  const envPath = process.env.COMPANY_LOGO_PATH?.trim();
  if (envPath && existsSync(envPath)) {
    return envPath;
  }
  const fallback = join(process.cwd(), "public", "company-logo.png");
  if (existsSync(fallback)) {
    return fallback;
  }
  return null;
}
