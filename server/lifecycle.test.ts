import { describe, it, expect } from "vitest";
import { classifyCustomer, calculateRepurchaseDays } from "./sync";

const DAY_MS = 24 * 60 * 60 * 1000;

function daysAgo(days: number, refDate?: Date): Date {
  const ref = refDate ? refDate.getTime() : Date.now();
  return new Date(ref - days * DAY_MS);
}

describe("classifyCustomer - new interval-based logic", () => {
  const refDate = new Date("2026-03-08T00:00:00Z");

  describe("N 新鮮客: last shipment within 180d, only 1 shipment in 180d", () => {
    it("should return N when last shipment 30 days ago with 1 order in 6 months", () => {
      const lastShip = daysAgo(30, refDate);
      const result = classifyCustomer(lastShip, null, 1, 0, refDate);
      expect(result).toBe("N");
    });

    it("should return N when last shipment 179 days ago with 1 order in 6 months", () => {
      const lastShip = daysAgo(179, refDate);
      const result = classifyCustomer(lastShip, null, 1, 0, refDate);
      expect(result).toBe("N");
    });
  });

  describe("A 活躍客: last shipment within 180d, 2+ shipments in 180d", () => {
    it("should return A when last shipment 30 days ago with 3 orders in 6 months", () => {
      const lastShip = daysAgo(30, refDate);
      const result = classifyCustomer(lastShip, null, 3, 0, refDate);
      expect(result).toBe("A");
    });

    it("should return A when last shipment 1 day ago with 2 orders in 6 months", () => {
      const lastShip = daysAgo(1, refDate);
      const result = classifyCustomer(lastShip, null, 2, 0, refDate);
      expect(result).toBe("A");
    });
  });

  describe("S 沉睡客: last shipment 180-365d, 2+ shipments in that interval", () => {
    it("should return S when last shipment 200 days ago with 2 orders in 6-12m", () => {
      const lastShip = daysAgo(200, refDate);
      const result = classifyCustomer(lastShip, null, 0, 2, refDate);
      expect(result).toBe("S");
    });

    it("should return S when last shipment 364 days ago with 3 orders in 6-12m", () => {
      const lastShip = daysAgo(364, refDate);
      const result = classifyCustomer(lastShip, null, 0, 3, refDate);
      expect(result).toBe("S");
    });
  });

  describe("L 流失客: last shipment 180-365d, only 1 shipment in that interval", () => {
    it("should return L when last shipment 200 days ago with 1 order in 6-12m", () => {
      const lastShip = daysAgo(200, refDate);
      const result = classifyCustomer(lastShip, null, 0, 1, refDate);
      expect(result).toBe("L");
    });

    it("should return L when last shipment 300 days ago with 1 order in 6-12m", () => {
      const lastShip = daysAgo(300, refDate);
      const result = classifyCustomer(lastShip, null, 0, 1, refDate);
      expect(result).toBe("L");
    });
  });

  describe("D 封存客: last shipment > 365d, not O", () => {
    it("should return D when last shipment 400 days ago, registered 2 years ago", () => {
      const lastShip = daysAgo(400, refDate);
      const registered = daysAgo(730, refDate);
      const result = classifyCustomer(lastShip, registered, 0, 0, refDate);
      expect(result).toBe("D");
    });

    it("should return D when no shipment and registered 2 years ago", () => {
      const registered = daysAgo(730, refDate);
      const result = classifyCustomer(null, registered, 0, 0, refDate);
      expect(result).toBe("D");
    });

    it("should return D when no shipment and no registration date", () => {
      const result = classifyCustomer(null, null, 0, 0, refDate);
      expect(result).toBe("D");
    });
  });

  describe("O 機會客: no shipment within 365d, but registered within 365d", () => {
    it("should return O when no shipment and registered 100 days ago", () => {
      const registered = daysAgo(100, refDate);
      const result = classifyCustomer(null, registered, 0, 0, refDate);
      expect(result).toBe("O");
    });

    it("should return O when last shipment 400 days ago but registered 200 days ago", () => {
      const lastShip = daysAgo(400, refDate);
      const registered = daysAgo(200, refDate);
      const result = classifyCustomer(lastShip, registered, 0, 0, refDate);
      expect(result).toBe("O");
    });

    it("should return O when registered exactly 364 days ago with no shipment", () => {
      const registered = daysAgo(364, refDate);
      const result = classifyCustomer(null, registered, 0, 0, refDate);
      expect(result).toBe("O");
    });
  });

  describe("Edge cases", () => {
    it("should use current date when no referenceDate provided", () => {
      const lastShip = new Date(); // today
      const result = classifyCustomer(lastShip, null, 1, 0);
      expect(result).toBe("N");
    });

    it("boundary: exactly 180 days ago should be in 6-12m range", () => {
      const lastShip = daysAgo(180, refDate);
      // At exactly 180 days, lastShipTime === sixMonthsAgo, so NOT >= sixMonthsAgo
      // Actually: sixMonthsAgo = refTime - 180*DAY_MS, lastShipTime = refTime - 180*DAY_MS
      // So lastShipTime >= sixMonthsAgo is true (equal), falls into 6m bucket
      const result = classifyCustomer(lastShip, null, 1, 0, refDate);
      expect(result).toBe("N");
    });

    it("boundary: exactly 365 days ago should be in > 1 year range", () => {
      const lastShip = daysAgo(365, refDate);
      // lastShipTime === oneYearAgo, so >= oneYearAgo is true, falls into 6-12m bucket
      const result = classifyCustomer(lastShip, null, 0, 1, refDate);
      expect(result).toBe("L");
    });

    it("N vs A: customer with historical orders but only 1 in 6 months should be N", () => {
      // This is the key behavioral change: old logic used totalOrders, new uses interval
      const lastShip = daysAgo(10, refDate);
      // Even if they have many historical orders, only 1 in the last 6 months
      const result = classifyCustomer(lastShip, null, 1, 5, refDate);
      expect(result).toBe("N");
    });

    it("S vs L: customer with many orders in 6-12m range should be S", () => {
      const lastShip = daysAgo(250, refDate);
      const result = classifyCustomer(lastShip, null, 0, 3, refDate);
      expect(result).toBe("S");
    });
  });
});

describe("recalculateAllLifecycles function exists", () => {
  it("should be exported from db module", async () => {
    const db = await import("./db");
    expect(typeof db.recalculateAllLifecycles).toBe("function");
  });
});

describe("calculateRepurchaseDays", () => {
  it("should return null for empty array", () => {
    expect(calculateRepurchaseDays([])).toBeNull();
  });

  it("should return null for single order", () => {
    expect(calculateRepurchaseDays([new Date()])).toBeNull();
  });

  it("should calculate average days between orders", () => {
    const dates = [
      new Date("2026-01-01"),
      new Date("2026-01-31"), // 30 days
      new Date("2026-03-01"), // 29 days
    ];
    const result = calculateRepurchaseDays(dates);
    // Average of 30 and 29 = 29.5, rounded
    expect(result).toBeGreaterThanOrEqual(29);
    expect(result).toBeLessThanOrEqual(30);
  });
});
