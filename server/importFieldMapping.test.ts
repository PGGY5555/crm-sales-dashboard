import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { parseCsvToRows } from "../shared/spreadsheetParse";
import {
  ORDER_IMPORT_COLUMNS,
  getCustomerExternalId,
  getCustomerIdentityFields,
  getOrderNumberFromRow,
  normalizeCustomerImportRow,
  normalizeOrderImportRow,
  pickOrderShippingAddress,
} from "../shared/importFieldMapping";

const fixtureDir = path.resolve(import.meta.dirname, "../暫存");

describe("importFieldMapping - 會員匯出 CSV", () => {
  it("maps member export columns and reads all rows", () => {
    const filePath = path.join(fixtureDir, "會員匯出_20260606.csv");
    if (!fs.existsSync(filePath)) return;

    const buffer = fs.readFileSync(filePath);
    const rows = parseCsvToRows(buffer);
    expect(rows.length).toBeGreaterThan(0);

    const first = normalizeCustomerImportRow(rows[0]);
    expect(getCustomerIdentityFields(first).name).toBe("Chu");
    expect(getCustomerIdentityFields(first).email).toBe("devil750113@yahoo.com.tw");
    expect(getCustomerIdentityFields(first).phone).toBe("0988084085");
    expect(first["會員等級"]).toBe("美麗會員");
    expect(getCustomerExternalId(first, "fallback")).toBe("devil750113@yahoo.com.tw");
  });
});

describe("importFieldMapping - 訂單匯出 CSV", () => {
  it("maps order export columns and groups by 訂編", () => {
    const filePath = path.join(fixtureDir, "訂單匯出_含SKU_20260607 (10).csv");
    if (!fs.existsSync(filePath)) return;

    const buffer = fs.readFileSync(filePath);
    const rows = parseCsvToRows(buffer);
    expect(rows.length).toBeGreaterThan(0);

    const orderMap = new Map<string, Record<string, unknown>[]>();
    for (const row of rows) {
      const normalized = normalizeOrderImportRow(row);
      const orderNum = getOrderNumberFromRow(normalized);
      if (!orderMap.has(orderNum)) orderMap.set(orderNum, []);
      orderMap.get(orderNum)!.push(normalized);
    }

    expect(orderMap.size).toBeGreaterThan(0);

    const [firstOrderNum, firstItems] = [...orderMap.entries()][0];
    expect(firstOrderNum).toBe("D2605150341TZE");
    expect(firstItems.length).toBe(1);
    expect(firstItems[0]["品名"]).toContain("雪白美晶膠原蛋白肽");
    expect(firstItems[0]["SKU"]).toBe("SET_GSH60");
    expect(firstItems[0]["訂單金額"]).toBe("1530");
    expect(firstItems[0]["顧客"]).toBe("余采璇");
    expect(firstItems[0]["顧客 Email"]).toBe("ycx981215@gmail.com");
    expect(Object.keys(firstItems[0]).every((k) => ORDER_IMPORT_COLUMNS.includes(k as any))).toBe(true);
  });
});

describe("importFieldMapping", () => {
  it("maps export column names to canonical customer fields", () => {
    const normalized = normalizeCustomerImportRow({
      "顧客姓名": "王小明",
      "手機": "0912345678",
      "電子信箱": "a@test.com",
    });

    expect(normalized["顧客名稱"]).toBe("王小明");
    expect(normalized["電話"]).toBe("0912345678");
    expect(getCustomerIdentityFields(normalized)).toEqual({
      name: "王小明",
      email: "a@test.com",
      phone: "0912345678",
    });
  });

  it("maps order export headers", () => {
    const normalized = normalizeOrderImportRow({
      "訂單日期": "2026-06-05 04:51",
      "訂編": "D2606050451H69",
      "顧客": "陳家琳",
      "顧客 Email": "b@test.com",
      "顧客手機": "0903871669",
      "收件人名": "陳家琳",
      "收件人電話": "0903871669",
      "寄送方式": "全家超商取貨",
      "訂單金額": "1398",
      "出貨單號": "48452478",
      "出貨日期": "2026-06-05 06:30",
      "品名": "雪白美晶膠原蛋白肽",
      "SKU": "SET_GSH20",
      "規格": "1盒20包",
      "數量": "1",
      "單價": "699",
      "地址": "測試路",
      "門市名": "測試門市",
      "舊欄位不應保留": "x",
    });

    expect(getOrderNumberFromRow(normalized)).toBe("D2606050451H69");
    expect(normalized["訂單日期"]).toBe("2026-06-05 04:51");
    expect(normalized["品名"]).toBe("雪白美晶膠原蛋白肽");
    expect(normalized["SKU"]).toBe("SET_GSH20");
    expect(normalized["舊欄位不應保留"]).toBeUndefined();
    expect(pickOrderShippingAddress(normalized)).toBe("測試路 測試門市");
  });

  it("ORDER_IMPORT_COLUMNS matches standard export format", () => {
    expect(ORDER_IMPORT_COLUMNS).toEqual([
      "訂單日期", "訂編", "顧客", "顧客 Email", "顧客手機", "LINE UID",
      "收件人名", "收件人電話", "訂單狀態", "付款狀態", "出貨狀態", "寄送方式",
      "訂單金額", "付款方式", "貨到付款金額", "出貨單號", "地址", "門市名",
      "發票號碼", "手機載具", "統一編號", "抬頭", "捐贈碼", "顧客備註", "出貨日期",
      "SKU", "品名", "規格", "數量", "單價", "小計",
    ]);
  });
});
