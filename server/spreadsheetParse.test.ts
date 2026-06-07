import { describe, expect, it } from "vitest";
import {
  detectSpreadsheetFormat,
  parseCsvToRows,
  assertSpreadsheetFormatSupported,
} from "../shared/spreadsheetParse";

describe("spreadsheetParse", () => {
  it("detects xlsx by PK signature", () => {
    const data = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
    expect(detectSpreadsheetFormat(data, "data.csv")).toBe("xlsx");
  });

  it("detects xls by OLE signature", () => {
    const data = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0]);
    expect(detectSpreadsheetFormat(data, "data.xlsx")).toBe("xls");
  });

  it("detects csv by extension", () => {
    const data = new TextEncoder().encode("a,b\n1,2");
    expect(detectSpreadsheetFormat(data, "customers.csv")).toBe("csv");
  });

  it("parses csv rows with headers", () => {
    const csv = "顧客名稱,電子信箱,電話\n王小明,a@b.com,0912345678\n";
    const rows = parseCsvToRows(new TextEncoder().encode(csv));
    expect(rows).toHaveLength(1);
    expect(rows[0]["顧客名稱"]).toBe("王小明");
    expect(rows[0]["電子信箱"]).toBe("a@b.com");
    expect(rows[0]["電話"]).toBe("0912345678");
  });

  it("parses quoted csv fields", () => {
    const csv = 'name,note\n"Foo, Inc","line1, line2"\n';
    const rows = parseCsvToRows(new TextEncoder().encode(csv));
    expect(rows[0].name).toBe("Foo, Inc");
    expect(rows[0].note).toBe("line1, line2");
  });

  it("parses tab-separated csv", () => {
    const csv = "顧客姓名\t手機\t電子信箱\n王小明\t0912345678\ta@test.com\n";
    const rows = parseCsvToRows(new TextEncoder().encode(csv));
    expect(rows).toHaveLength(1);
    expect(rows[0]["顧客姓名"]).toBe("王小明");
  });

  it("rejects xls format with clear message", () => {
    expect(() => assertSpreadsheetFormatSupported("xls")).toThrow(/不支援舊版 Excel/);
  });
});
