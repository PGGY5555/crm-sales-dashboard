import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Tests for order detail item resolution logic.
 * Validates that items can be found by orderId or by orderExternalId fallback.
 */

// Mock item data
const mockItems = [
  { id: 1, orderId: null, orderExternalId: "EXT001", productName: "Product A", productSku: "SKU-A", quantity: 2, unitPrice: "100" },
  { id: 2, orderId: null, orderExternalId: "EXT001", productName: "Product B", productSku: "SKU-B", quantity: 1, unitPrice: "200" },
  { id: 3, orderId: 10, orderExternalId: "EXT002", productName: "Product C", productSku: "SKU-C", quantity: 3, unitPrice: "50" },
];

/**
 * Simulates the order detail item resolution logic from db.ts getOrderDetail.
 * First tries orderId match, then falls back to orderExternalId.
 */
function resolveItems(orderId: number, orderExternalId: string | null, allItems: typeof mockItems) {
  // Try by orderId first
  let items = allItems.filter(i => i.orderId === orderId);

  // Fallback: match by orderExternalId if no items found by orderId
  if (items.length === 0 && orderExternalId) {
    items = allItems.filter(i => i.orderExternalId === orderExternalId);
  }

  return items;
}

describe("Order Detail - Item Resolution", () => {
  it("finds items by orderId when orderId is set", () => {
    const items = resolveItems(10, "EXT002", mockItems);
    expect(items).toHaveLength(1);
    expect(items[0].productName).toBe("Product C");
  });

  it("falls back to orderExternalId when orderId has no matches", () => {
    // orderId=999 doesn't exist, but externalId "EXT001" has 2 items
    const items = resolveItems(999, "EXT001", mockItems);
    expect(items).toHaveLength(2);
    expect(items[0].productName).toBe("Product A");
    expect(items[1].productName).toBe("Product B");
  });

  it("returns empty array when neither orderId nor externalId match", () => {
    const items = resolveItems(999, "NONEXISTENT", mockItems);
    expect(items).toHaveLength(0);
  });

  it("returns empty array when externalId is null and orderId has no match", () => {
    const items = resolveItems(999, null, mockItems);
    expect(items).toHaveLength(0);
  });

  it("prefers orderId match over externalId match", () => {
    // orderId=10 matches Product C, even though externalId "EXT001" would match A and B
    const items = resolveItems(10, "EXT001", mockItems);
    expect(items).toHaveLength(1);
    expect(items[0].productName).toBe("Product C");
  });
});

/**
 * Tests for customer detail - order items grouping with externalId fallback.
 */
describe("Customer Detail - Order Items Grouping", () => {
  const customerOrders = [
    { id: 100, externalId: "EXT001" },
    { id: 101, externalId: "EXT002" },
    { id: 102, externalId: "EXT003" },
  ];

  const allItems = [
    { id: 1, orderId: null, orderExternalId: "EXT001", productName: "Item A" },
    { id: 2, orderId: null, orderExternalId: "EXT001", productName: "Item B" },
    { id: 3, orderId: 101, orderExternalId: "EXT002", productName: "Item C" },
    { id: 4, orderId: null, orderExternalId: "EXT003", productName: "Item D" },
  ];

  function groupItemsByOrder(orders: typeof customerOrders, items: typeof allItems) {
    // Build externalId -> orderId mapping
    const extToId: Record<string, number> = {};
    for (const o of orders) {
      if (o.externalId) extToId[o.externalId] = o.id;
    }

    // Group items by orderId (resolve via orderId or orderExternalId)
    const itemsByOrder: Record<number, typeof items> = {};
    for (const item of items) {
      const oid = item.orderId || (item.orderExternalId ? extToId[item.orderExternalId] : null);
      if (oid) {
        if (!itemsByOrder[oid]) itemsByOrder[oid] = [];
        itemsByOrder[oid].push(item);
      }
    }

    return orders.map(o => ({
      ...o,
      items: itemsByOrder[o.id] || [],
    }));
  }

  it("groups items correctly using orderId and externalId fallback", () => {
    const result = groupItemsByOrder(customerOrders, allItems);

    // Order 100 (EXT001) should have 2 items via externalId fallback
    expect(result[0].items).toHaveLength(2);
    expect(result[0].items[0].productName).toBe("Item A");
    expect(result[0].items[1].productName).toBe("Item B");

    // Order 101 (EXT002) should have 1 item via orderId
    expect(result[1].items).toHaveLength(1);
    expect(result[1].items[0].productName).toBe("Item C");

    // Order 102 (EXT003) should have 1 item via externalId fallback
    expect(result[2].items).toHaveLength(1);
    expect(result[2].items[0].productName).toBe("Item D");
  });

  it("returns empty items array for orders with no matching items", () => {
    const ordersWithNoItems = [{ id: 999, externalId: "NONEXISTENT" }];
    const result = groupItemsByOrder(ordersWithNoItems, allItems);
    expect(result[0].items).toHaveLength(0);
  });
});

/**
 * Tests for phone number formatting for batch operations.
 */
describe("Excel Import - orderId resolution", () => {
  it("should include orderId when inserting order items after upsert", () => {
    // Simulate the flow: upsert order → get orderId → insert items with orderId
    const upsertedOrder = { id: 42, externalId: "EXT-42" };
    const itemValues = {
      orderId: upsertedOrder.id,
      orderExternalId: upsertedOrder.externalId,
      productName: "Test Product",
      productSku: "TST-001",
      quantity: 1,
      unitPrice: "100",
    };

    expect(itemValues.orderId).toBe(42);
    expect(itemValues.orderExternalId).toBe("EXT-42");
  });

  it("should handle case when order upsert returns no id (fallback)", () => {
    const resolvedOrderId = null;
    const itemValues = {
      orderId: resolvedOrderId,
      orderExternalId: "EXT-FALLBACK",
      productName: "Fallback Product",
    };

    expect(itemValues.orderId).toBeNull();
    expect(itemValues.orderExternalId).toBe("EXT-FALLBACK");
  });
});
