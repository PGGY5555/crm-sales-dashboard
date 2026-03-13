import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the database
const mockUpdate = vi.fn();
const mockSet = vi.fn();
const mockWhere = vi.fn();

vi.mock("./db", () => ({
  getDb: vi.fn().mockResolvedValue({
    update: (...args: any[]) => {
      mockUpdate(...args);
      return {
        set: (...setArgs: any[]) => {
          mockSet(...setArgs);
          return {
            where: (...whereArgs: any[]) => {
              mockWhere(...whereArgs);
              return [{ affectedRows: 5 }];
            },
          };
        },
      };
    },
  }),
}));

// Must import after mocks
import { clearRawData } from "./clearRawData";
import { customers, orders, products } from "../drizzle/schema";

describe("clearRawData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should clear rawData for all three tables by default", async () => {
    const result = await clearRawData();

    // Should call update 3 times (customers, orders, products)
    expect(mockUpdate).toHaveBeenCalledTimes(3);
    expect(mockUpdate).toHaveBeenCalledWith(customers);
    expect(mockUpdate).toHaveBeenCalledWith(orders);
    expect(mockUpdate).toHaveBeenCalledWith(products);

    // Should set rawData to null
    expect(mockSet).toHaveBeenCalledTimes(3);
    for (let i = 0; i < 3; i++) {
      expect(mockSet.mock.calls[i][0]).toEqual({ rawData: null });
    }

    // Should return cleared counts
    expect(result.cleared).toEqual({
      customers: 5,
      orders: 5,
      products: 5,
    });
  });

  it("should clear rawData for only specified tables", async () => {
    const result = await clearRawData(["customers"]);

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith(customers);
    expect(result.cleared).toEqual({ customers: 5 });
  });

  it("should clear rawData for customers and orders only", async () => {
    const result = await clearRawData(["customers", "orders"]);

    expect(mockUpdate).toHaveBeenCalledTimes(2);
    expect(mockUpdate).toHaveBeenCalledWith(customers);
    expect(mockUpdate).toHaveBeenCalledWith(orders);
    expect(result.cleared).toEqual({ customers: 5, orders: 5 });
  });

  it("should handle database unavailable gracefully", async () => {
    const { getDb } = await import("./db");
    (getDb as any).mockResolvedValueOnce(null);

    const result = await clearRawData();
    expect(result.cleared).toEqual({});
  });
});
