import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Placeholder for future authentication.
// For now this app is public for testing.
export function middleware(_req: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
};

