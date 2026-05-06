export type InventoryItem = {
  sku: string;
  name: string;
  quality: string | null;
  viewPlantUrl: string | null;
  farmCode?: string | null;
  availabilityQty: number;
  priceCents: number;
  currency: string;
};

export type CartLine = {
  sku: string;
  quantity: number;
};

export type PreliminaryOrderLine = {
  id: number;
  sku: string;
  itemName: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
};

export type PreliminaryOrder = {
  id: number;
  orderNumber: number;
  status: string;
  createdAt: string;
  customerName: string;
  contact: string | null;
  specialInstructions: string | null;
  shipTo: string;
  preferredDeliveryDate: string | null;
  poNumber: string | null;
  lines: PreliminaryOrderLine[];
};

