import { promises as fs } from "fs";
import { NextResponse } from "next/server";
import { resolveCompanyLogoPath } from "@/lib/companyLogo";

export async function GET() {
  try {
    const logoPath = resolveCompanyLogoPath();
    if (!logoPath) {
      return NextResponse.json({ error: "Company logo not found." }, { status: 404 });
    }
    const file = await fs.readFile(logoPath);
    return new NextResponse(new Uint8Array(file), {
      headers: {
        "content-type": "image/png",
        "cache-control": "public, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "Company logo not found." }, { status: 404 });
  }
}

