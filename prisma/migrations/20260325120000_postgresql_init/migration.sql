-- CreateTable
CREATE TABLE "InventoryItem" (
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "quality" TEXT,
    "viewPlantUrl" TEXT,
    "availabilityQty" INTEGER NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("sku")
);

-- CreateTable
CREATE TABLE "PreliminaryOrder" (
    "orderNumber" SERIAL NOT NULL,
    "customerName" TEXT NOT NULL,
    "contact" TEXT,
    "salesRepName" TEXT,
    "salesRepEmail" TEXT,
    "shipTo" TEXT NOT NULL,
    "preferredDeliveryDate" TIMESTAMP(3),
    "poNumber" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PRELIMINARY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PreliminaryOrder_pkey" PRIMARY KEY ("orderNumber")
);

-- CreateTable
CREATE TABLE "PreliminaryOrderLine" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER NOT NULL,
    "sku" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "unitPriceCents" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "lineTotalCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PreliminaryOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PreliminaryOrderLine_orderId_idx" ON "PreliminaryOrderLine"("orderId");

-- CreateIndex
CREATE INDEX "PreliminaryOrderLine_sku_idx" ON "PreliminaryOrderLine"("sku");

-- AddForeignKey
ALTER TABLE "PreliminaryOrderLine" ADD CONSTRAINT "PreliminaryOrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PreliminaryOrder"("orderNumber") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PreliminaryOrderLine" ADD CONSTRAINT "PreliminaryOrderLine_sku_fkey" FOREIGN KEY ("sku") REFERENCES "InventoryItem"("sku") ON DELETE RESTRICT ON UPDATE CASCADE;
