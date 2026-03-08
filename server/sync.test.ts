import { describe, expect, it } from "vitest";
import { classifyCustomer, calculateRepurchaseDays } from "./sync";

describe("classifyCustomer", () => {
  const now = Date.now();
  const oneDay = 24 * 60 * 60 * 1000;
  const sixMonthsMs = 180 * oneDay;
  const oneYearMs = 365 * oneDay;
  const refDate = new Date(now);

  // New signature: classifyCustomer(lastShipmentAt, registeredAt, ordersInSixMonths, ordersInSixToYear, referenceDate?)

  it("N 新鮮客：半年內出貨，180天內僅出貨1次", () => {
    const lastShipment = new Date(now - 30 * oneDay);
    expect(classifyCustomer(lastShipment, null, 1, 0, refDate)).toBe("N");
  });

  it("A 活躍客：半年內出貨，180天內出貨2次以上", () => {
    const lastShipment = new Date(now - 30 * oneDay);
    expect(classifyCustomer(lastShipment, null, 3, 0, refDate)).toBe("A");
  });

  it("A 活躍客：半年內出貨，180天內出貨2次", () => {
    const lastShipment = new Date(now - 100 * oneDay);
    expect(classifyCustomer(lastShipment, null, 2, 0, refDate)).toBe("A");
  });

  it("S 沉睡客：半年到一年內出貨，180-365天區間出貨2次以上", () => {
    const lastShipment = new Date(now - 200 * oneDay);
    expect(classifyCustomer(lastShipment, null, 0, 5, refDate)).toBe("S");
  });

  it("L 流失客：半年到一年內出貨，180-365天區間僅出貨1次", () => {
    const lastShipment = new Date(now - 250 * oneDay);
    expect(classifyCustomer(lastShipment, null, 0, 1, refDate)).toBe("L");
  });

  it("D 封存客：一年內都沒買，且沒有一年內註冊", () => {
    const lastShipment = new Date(now - 400 * oneDay);
    expect(classifyCustomer(lastShipment, null, 0, 0, refDate)).toBe("D");
  });

  it("D 封存客：沒有出貨記錄，也沒有一年內註冊", () => {
    expect(classifyCustomer(null, null, 0, 0, refDate)).toBe("D");
  });

  it("D 封存客：沒有出貨記錄，註冊超過一年", () => {
    const registered = new Date(now - 400 * oneDay);
    expect(classifyCustomer(null, registered, 0, 0, refDate)).toBe("D");
  });

  it("O 機會客：一年內都沒買，但有一年內註冊", () => {
    const registered = new Date(now - 100 * oneDay);
    expect(classifyCustomer(null, registered, 0, 0, refDate)).toBe("O");
  });

  it("O 機會客：出貨超過一年，但有一年內註冊", () => {
    const lastShipment = new Date(now - 400 * oneDay);
    const registered = new Date(now - 200 * oneDay);
    expect(classifyCustomer(lastShipment, registered, 0, 0, refDate)).toBe("O");
  });

  it("邊界：恰好半年前出貨（差一天），180-365天區間僅1次 → L 流失客", () => {
    const lastShipment = new Date(now - sixMonthsMs - oneDay);
    expect(classifyCustomer(lastShipment, null, 0, 1, refDate)).toBe("L");
  });

  it("邊界：恰好半年內出貨（差一天），180天內僅1次 → N 新鮮客", () => {
    const lastShipment = new Date(now - sixMonthsMs + oneDay);
    expect(classifyCustomer(lastShipment, null, 1, 0, refDate)).toBe("N");
  });

  it("關鍵行為變更：歷史訂單多但半年內僅1次 → N 而非 A", () => {
    const lastShipment = new Date(now - 10 * oneDay);
    // ordersInSixMonths=1, ordersInSixToYear=5 (many historical orders)
    expect(classifyCustomer(lastShipment, null, 1, 5, refDate)).toBe("N");
  });
});

describe("calculateRepurchaseDays", () => {
  const oneDay = 24 * 60 * 60 * 1000;

  it("少於 2 筆訂單返回 null", () => {
    expect(calculateRepurchaseDays([])).toBeNull();
    expect(calculateRepurchaseDays([new Date()])).toBeNull();
  });

  it("2 筆訂單計算間隔天數", () => {
    const d1 = new Date("2024-01-01");
    const d2 = new Date("2024-01-31");
    expect(calculateRepurchaseDays([d1, d2])).toBe(30);
  });

  it("3 筆訂單計算平均間隔", () => {
    const d1 = new Date("2024-01-01");
    const d2 = new Date("2024-01-11"); // 10 days
    const d3 = new Date("2024-01-31"); // 20 days
    // Average: (10 + 20) / 2 = 15
    expect(calculateRepurchaseDays([d1, d2, d3])).toBe(15);
  });

  it("日期順序不影響結果", () => {
    const d1 = new Date("2024-01-31");
    const d2 = new Date("2024-01-01");
    const d3 = new Date("2024-01-11");
    expect(calculateRepurchaseDays([d1, d2, d3])).toBe(15);
  });

  it("4 筆訂單計算平均間隔", () => {
    const d1 = new Date("2024-01-01");
    const d2 = new Date("2024-02-01"); // 31 days
    const d3 = new Date("2024-03-01"); // 29 days
    const d4 = new Date("2024-04-01"); // 31 days
    // Average: (31 + 29 + 31) / 3 ≈ 30.33 → 30
    expect(calculateRepurchaseDays([d1, d2, d3, d4])).toBe(30);
  });
});
