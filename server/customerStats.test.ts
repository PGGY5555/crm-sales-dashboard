import { describe, expect, it } from "vitest";
import { isValidOrderForStats, validOrderStatusSql, CUSTOMER_ID_STATS_BATCH } from "./customerStats";
import { mergeImportStatsHints, parseImportStatsHints, parseJobResultField } from "../shared/importStats";

describe("customerStats", () => {
  it("includes 已完成 and 已出貨 orders", () => {
    expect(isValidOrderForStats({ orderStatusText: "已完成" })).toBe(true);
    expect(isValidOrderForStats({ orderStatusText: "已出貨" })).toBe(true);
    expect(isValidOrderForStats({ orderStatusText: null })).toBe(true);
  });

  it("excludes cancelled and returned orders", () => {
    expect(isValidOrderForStats({ orderStatus: -1, orderStatusText: "已出貨" })).toBe(false);
    expect(isValidOrderForStats({ orderStatusText: "已出貨", shippingStatus: "已退貨" })).toBe(false);
    expect(isValidOrderForStats({ orderStatusText: "已取消" })).toBe(false);
  });

  it("validOrderStatusSql includes 已出貨", () => {
    expect(validOrderStatusSql()).toContain("已出貨");
  });

  it("parseImportStatsHints reads statsHints from JSON string result", () => {
    const result = JSON.stringify({
      statsHints: {
        customerIds: [5, 5],
        emails: [" u@x.com "],
        orderExternalIds: ["ORD-1"],
      },
    });
    expect(parseImportStatsHints(result)).toEqual({
      customerIds: [5],
      emails: ["u@x.com"],
      phones: [],
      orderExternalIds: ["ORD-1"],
    });
  });

  it("mergeImportStatsHints deduplicates customer ids and contact fields", () => {
    const merged = mergeImportStatsHints(
      { customerIds: [1, 2], emails: ["a@x.com"], orderExternalIds: ["O1"] },
      { customerIds: [2, 3], phones: ["0912"], orderExternalIds: ["O2"] },
    );
    expect(merged.customerIds).toEqual([1, 2, 3]);
    expect(merged.emails).toEqual(["a@x.com"]);
    expect(merged.phones).toEqual(["0912"]);
    expect(merged.orderExternalIds).toEqual(["O1", "O2"]);
  });

  it("parseJobResultField parses JSON strings", () => {
    expect(parseJobResultField('{"statsHints":{"customerIds":[1]}}')).toEqual({
      statsHints: { customerIds: [1] },
    });
  });

  it("CUSTOMER_ID_STATS_BATCH stays within safe IN-clause range (100–200)", () => {
    expect(CUSTOMER_ID_STATS_BATCH).toBeGreaterThanOrEqual(100);
    expect(CUSTOMER_ID_STATS_BATCH).toBeLessThanOrEqual(200);
  });
});
