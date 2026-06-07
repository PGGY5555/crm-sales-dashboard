import { describe, expect, it } from "vitest";
import {
  buildOrderExportRow,
  flattenOrdersToExportRows,
  ORDER_EXPORT_COLUMNS,
} from "../shared/orderExport";

describe("orderExport", () => {
  it("exports rows in standard CSV column order", () => {
    const rows = flattenOrdersToExportRows([
      {
        externalId: "D2605150341TZE",
        orderDate: new Date("2026-05-15T03:41:00"),
        customerName: "余采璇",
        customerEmail: "ycx981215@gmail.com",
        customerPhone: "0966225069",
        customerLineUid: "Ufa3fefab8c6bf30a8b236515ed6413d4",
        recipientName: "余采璇",
        recipientPhone: "0966225069",
        orderStatusText: "已退貨(入庫)",
        progress: "未付款",
        shippingStatus: "到店待取",
        shippingMethod: "7-11 超商取貨",
        total: "1530",
        paymentMethod: "貨到付款",
        shipmentNumber: "76580454799",
        rawData: {
          "門市名": "東復門市",
          "貨到付款金額": "1530",
        },
        lineItems: [
          {
            productSku: "SET_GSH60",
            productName: "雪白美晶膠原蛋白肽 - 買2送1/組共60包",
            productSpec: "買2送1/組共60包",
            quantity: 1,
            unitPrice: "1680",
          },
        ],
      },
    ]);

    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0])).toEqual([...ORDER_EXPORT_COLUMNS]);
    expect(rows[0]["訂編"]).toBe("D2605150341TZE");
    expect(rows[0]["顧客 Email"]).toBe("ycx981215@gmail.com");
    expect(rows[0]["付款狀態"]).toBe("未付款");
    expect(rows[0]["出貨單號"]).toBe("76580454799");
    expect(rows[0]["門市名"]).toBe("東復門市");
    expect(rows[0]["SKU"]).toBe("SET_GSH60");
    expect(rows[0]["小計"]).toBe("1680");
  });

  it("prefers rawData values when present", () => {
    const row = buildOrderExportRow(
      {
        externalId: "D1",
        orderDate: new Date("2026-06-05T04:51:00"),
        rawData: {
          "訂單日期": "2026-06-05 04:51",
          "顧客": "陳家琳",
          "顧客 Email": "b@test.com",
          "出貨日期": "2026-06-05 06:30",
          "地址": "測試路",
          "門市名": "測試門市",
        },
      },
      { productName: "商品", quantity: 2, unitPrice: "100" },
    );

    expect(row["訂單日期"]).toBe("2026-06-05 04:51");
    expect(row["顧客"]).toBe("陳家琳");
    expect(row["出貨日期"]).toBe("2026-06-05 06:30");
    expect(row["小計"]).toBe("200");
  });
});
