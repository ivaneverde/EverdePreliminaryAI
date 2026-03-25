import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const now = new Date();

  const seedItems = [
    { sku: "MONSTERA-001", name: "Monstera Deliciosa (starter)", quality: "A", availabilityQty: 25, priceCents: 1899 },
    { sku: "FICUS-002", name: "Ficus elastica (rubber plant)", quality: "A", availabilityQty: 18, priceCents: 2499 },
    { sku: "POTHOS-003", name: "Golden Pothos (vining)", quality: "B", availabilityQty: 40, priceCents: 1299 },
    { sku: "SNAKE-004", name: "Sansevieria (snake plant)", quality: "A", availabilityQty: 12, priceCents: 2199 },
    { sku: "ZZ-005", name: "ZZ Plant (Zamioculcas zamiifolia)", quality: "A", availabilityQty: 8, priceCents: 2799 },
  ];

  for (const item of seedItems) {
    await prisma.inventoryItem.upsert({
      where: { sku: item.sku },
      update: {
        name: item.name,
        quality: item.quality,
        availabilityQty: item.availabilityQty,
        priceCents: item.priceCents,
        currency: "USD",
        updatedAt: now,
      },
      create: {
        sku: item.sku,
        name: item.name,
        quality: item.quality,
        availabilityQty: item.availabilityQty,
        priceCents: item.priceCents,
        currency: "USD",
      },
    });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });

