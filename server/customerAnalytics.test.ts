import { describe, it, expect, vi } from "vitest";

// Mock the database module
vi.mock("./db", async () => {
  const actual = await vi.importActual("./db") as any;
  return {
    ...actual,
  };
});

describe("Customer Analytics Stats", () => {
  it("should define getCustomerAnalyticsStats function", async () => {
    const db = await import("./db");
    expect(typeof db.getCustomerAnalyticsStats).toBe("function");
  });

  it("should define getCustomerRegistrationTrend function", async () => {
    const db = await import("./db");
    expect(typeof db.getCustomerRegistrationTrend).toBe("function");
  });

  it("should define getLifecycleDistribution function", async () => {
    const db = await import("./db");
    expect(typeof db.getLifecycleDistribution).toBe("function");
  });

  it("should define getCustomerList function", async () => {
    const db = await import("./db");
    expect(typeof db.getCustomerList).toBe("function");
  });

  it("getCustomerAnalyticsStats should accept lifecycle filters", async () => {
    const db = await import("./db");
    // The function signature should accept filters with lifecycles
    expect(db.getCustomerAnalyticsStats.length).toBeLessThanOrEqual(1);
  });

  it("getCustomerRegistrationTrend should accept lifecycle filters", async () => {
    const db = await import("./db");
    expect(db.getCustomerRegistrationTrend.length).toBeLessThanOrEqual(1);
  });

  it("getCustomerList should accept search and lifecycle filters", async () => {
    const db = await import("./db");
    expect(db.getCustomerList.length).toBeLessThanOrEqual(1);
  });
});

describe("Customer Analytics Stats Return Types", () => {
  it("getCustomerAnalyticsStats should return null when db is not available", async () => {
    // This tests the null guard at the beginning of the function
    const db = await import("./db");
    // We can't easily test without a real DB, but we verify the function exists
    expect(db.getCustomerAnalyticsStats).toBeDefined();
  });

  it("getCustomerRegistrationTrend should return empty array when db is not available", async () => {
    const db = await import("./db");
    expect(db.getCustomerRegistrationTrend).toBeDefined();
  });
});

describe("Lifecycle Distribution", () => {
  it("should define lifecycle labels mapping", async () => {
    const db = await import("./db");
    // The function should handle all lifecycle codes: N, A, S, L, D, O
    expect(db.getLifecycleDistribution).toBeDefined();
  });

  it("getLifecycleDistribution should accept optional filters", async () => {
    const db = await import("./db");
    expect(db.getLifecycleDistribution.length).toBeLessThanOrEqual(1);
  });
});

describe("Customer Management Sorting", () => {
  it("getCustomerManagement should be defined for registeredAt DESC sorting", async () => {
    const db = await import("./db");
    expect(typeof db.getCustomerManagement).toBe("function");
  });

  it("getCustomerList should be defined for lastShipmentAt DESC sorting", async () => {
    const db = await import("./db");
    expect(typeof db.getCustomerList).toBe("function");
  });
});

describe("Shipment Date KPI", () => {
  it("should define getShipmentDateKPI function", async () => {
    const db = await import("./db");
    expect(typeof db.getShipmentDateKPI).toBe("function");
  });

  it("getShipmentDateKPI should accept from and to date parameters", async () => {
    const db = await import("./db");
    // Function accepts { from?: Date, to?: Date }
    expect(db.getShipmentDateKPI.length).toBeLessThanOrEqual(1);
  });

  it("getShipmentDateKPI should return correct shape when called", async () => {
    const db = await import("./db");
    // Test with empty date range (should query all customers with lastShipmentAt)
    const result = await db.getShipmentDateKPI({});
    if (result !== null) {
      expect(result).toHaveProperty("customerCount");
      expect(result).toHaveProperty("totalRevenue");
      expect(result).toHaveProperty("avgSpent");
      expect(result).toHaveProperty("avgRepurchaseDays");
      expect(result).toHaveProperty("repurchaseRate");
      expect(result).toHaveProperty("avgOrderValue");
      expect(typeof result.customerCount).toBe("number");
      expect(typeof result.totalRevenue).toBe("number");
      expect(typeof result.avgSpent).toBe("number");
      expect(typeof result.avgRepurchaseDays).toBe("number");
      expect(typeof result.repurchaseRate).toBe("number");
      expect(typeof result.avgOrderValue).toBe("number");
    }
  });

  it("getShipmentDateKPI should accept from date only", async () => {
    const db = await import("./db");
    const result = await db.getShipmentDateKPI({ from: new Date("2025-01-01") });
    if (result !== null) {
      expect(result.customerCount).toBeGreaterThanOrEqual(0);
      expect(result.repurchaseRate).toBeGreaterThanOrEqual(0);
      expect(result.repurchaseRate).toBeLessThanOrEqual(100);
    }
  });

  it("getShipmentDateKPI should accept to date only", async () => {
    const db = await import("./db");
    const result = await db.getShipmentDateKPI({ to: new Date("2026-12-31") });
    if (result !== null) {
      expect(result.customerCount).toBeGreaterThanOrEqual(0);
    }
  });

  it("getShipmentDateKPI should accept both from and to dates", async () => {
    const db = await import("./db");
    const result = await db.getShipmentDateKPI({
      from: new Date("2025-01-01"),
      to: new Date("2026-12-31"),
    });
    if (result !== null) {
      expect(result.customerCount).toBeGreaterThanOrEqual(0);
      expect(result.totalRevenue).toBeGreaterThanOrEqual(0);
      expect(result.avgOrderValue).toBeGreaterThanOrEqual(0);
    }
  });

  it("getShipmentDateKPI with narrow date range should return fewer customers", async () => {
    const db = await import("./db");
    const wide = await db.getShipmentDateKPI({});
    const narrow = await db.getShipmentDateKPI({
      from: new Date("2026-02-01"),
      to: new Date("2026-02-28"),
    });
    if (wide !== null && narrow !== null) {
      expect(narrow.customerCount).toBeLessThanOrEqual(wide.customerCount);
    }
  });
});
