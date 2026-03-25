import { PrismaClient } from "@prisma/client";

// In Next.js dev mode, modules can reload frequently.
// Reuse a single PrismaClient instance to avoid connection storms.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

// Reuse one client per serverless instance (Vercel) and in dev (hot reload).
globalForPrisma.prisma = prisma;

