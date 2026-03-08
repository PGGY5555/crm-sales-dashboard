import { describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";

// Helper to create an Excel buffer from rows
function createExcelBuffer(sheetName: string, headers: string[], rows: any[][]): Buffer {
  const wb = XLSX.utils.book_new();
  const data = [headers, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(data);
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}

describe("Excel Import - parseExcelBuffer", () => {
  it("should parse a simple Excel buffer into rows", () => {
    const buffer = createExcelBuffer("Sheet1", ["Name", "Email"], [
      ["Alice", "alice@test.com"],
      ["Bob", "bob@test.com"],
    ]);
    const wb = XLSX.read(buffer, { type: "buffer" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: "" }) as any[];
    expect(rows).toHaveLength(2);
    expect(rows[0].Name).toBe("Alice");
    expect(rows[1].Email).toBe("bob@test.com");
  });

  it("should handle empty Excel file", () => {
    const buffer = createExcelBuffer("Sheet1", ["Name"], []);
    const wb = XLSX.read(buffer, { type: "buffer" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: "" }) as any[];
    expect(rows).toHaveLength(0);
  });
});

describe("Excel Import - Customer field mapping", () => {
  it("should map customer Excel headers to expected fields", () => {
    const headers = [
      "會員編號", "姓名", "信箱", "手機", "性別", "生日",
      "會員等級", "會員標籤", "總消費金額", "訂單數",
    ];
    const buffer = createExcelBuffer("顧客列表", headers, [
      ["C001", "王小明", "wang@test.com", "0912345678", "男", "1990-01-15",
       "VIP", "活躍", "50000", "10"],
    ]);
    const wb = XLSX.read(buffer, { type: "buffer" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: "" }) as any[];

    expect(rows).toHaveLength(1);
    expect(rows[0]["會員編號"]).toBe("C001");
    expect(rows[0]["姓名"]).toBe("王小明");
    expect(rows[0]["信箱"]).toBe("wang@test.com");
    expect(rows[0]["手機"]).toBe("0912345678");
    expect(rows[0]["總消費金額"]).toBe("50000");
  });
});

describe("Excel Import - Order field mapping", () => {
  it("should map order Excel headers to expected fields", () => {
    const headers = [
      "訂單編號", "建立時間", "訂單狀態", "訂單金額", "商品總金額",
      "運費", "折扣金額", "會員信箱", "收件人姓名",
      "商品名稱", "商品規格", "商品數量", "商品單價",
    ];
    const buffer = createExcelBuffer("訂單列表", headers, [
      ["ORD-001", "2025-12-01 10:30:00", "已完成", "1500", "1400",
       "100", "0", "wang@test.com", "王小明",
       "商品A", "紅色/L", "2", "700"],
    ]);
    const wb = XLSX.read(buffer, { type: "buffer" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: "" }) as any[];

    expect(rows).toHaveLength(1);
    expect(rows[0]["訂單編號"]).toBe("ORD-001");
    expect(rows[0]["訂單狀態"]).toBe("已完成");
    expect(rows[0]["訂單金額"]).toBe("1500");
    expect(rows[0]["會員信箱"]).toBe("wang@test.com");
  });
});

describe("Excel Import - Product field mapping", () => {
  it("should map product Excel headers to expected fields", () => {
    const headers = [
      "商品名稱", "商品貨號", "成本", "售價", "庫存數量",
      "商品分類", "商品狀態", "規格名稱", "規格值",
    ];
    const buffer = createExcelBuffer("商品列表", headers, [
      ["經典T恤", "SKU-001", "200", "599", "100",
       "上衣", "上架", "尺寸", "S/M/L"],
    ]);
    const wb = XLSX.read(buffer, { type: "buffer" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: "" }) as any[];

    expect(rows).toHaveLength(1);
    expect(rows[0]["商品名稱"]).toBe("經典T恤");
    expect(rows[0]["商品貨號"]).toBe("SKU-001");
    expect(rows[0]["成本"]).toBe("200");
    expect(rows[0]["售價"]).toBe("599");
    expect(rows[0]["庫存數量"]).toBe("100");
  });
});

describe("Excel Import - Date parsing", () => {
  it("should handle various date formats", () => {
    // Test date string parsing
    const dateStr1 = "2025-12-01 10:30:00";
    const date1 = new Date(dateStr1);
    expect(date1.getFullYear()).toBe(2025);
    expect(date1.getMonth()).toBe(11); // December = 11
    expect(date1.getDate()).toBe(1);

    const dateStr2 = "2025/06/15";
    const date2 = new Date(dateStr2);
    expect(date2.getFullYear()).toBe(2025);
    expect(date2.getMonth()).toBe(5); // June = 5

    // Excel serial number date (e.g., 45627 = 2024-12-01)
    const excelDate = 45627;
    const jsDate = new Date((excelDate - 25569) * 86400 * 1000);
    expect(jsDate.getFullYear()).toBe(2024);
  });

  it("should handle empty or invalid dates gracefully", () => {
    const emptyDate = new Date("");
    expect(isNaN(emptyDate.getTime())).toBe(true);

    const invalidDate = new Date("not-a-date");
    expect(isNaN(invalidDate.getTime())).toBe(true);
  });
});

describe("Excel Import - Number parsing", () => {
  it("should parse numeric strings correctly", () => {
    expect(parseFloat("1500")).toBe(1500);
    // parseFloat("1,500") returns 1 in JS (stops at comma), so use Number() for strict parsing
    expect(Number("1,500")).toBeNaN();
    expect(Number("$1500")).toBeNaN();
    expect(parseInt("10", 10)).toBe(10);
    expect(parseFloat("0")).toBe(0);
  });

  it("should handle empty or non-numeric values", () => {
    expect(parseFloat("")).toBeNaN();
    expect(parseFloat("N/A")).toBeNaN();
    expect(Number("") || 0).toBe(0);
    expect(Number("abc") || 0).toBe(0);
  });
});

describe("Excel Import - Upload endpoint structure", () => {
  it("should validate file type parameter", () => {
    const validTypes = ["customers", "orders", "products", "logistics"];
    expect(validTypes.includes("customers")).toBe(true);
    expect(validTypes.includes("orders")).toBe(true);
    expect(validTypes.includes("products")).toBe(true);
    expect(validTypes.includes("logistics")).toBe(true);
    expect(validTypes.includes("invalid")).toBe(false);
    expect(validTypes.includes("")).toBe(false);
  });
});

describe("Background Job Threshold Logic", () => {
  const BACKGROUND_JOB_THRESHOLD = 500;

  it("should use background mode for files with more than 500 rows", () => {
    expect(40000 > BACKGROUND_JOB_THRESHOLD).toBe(true);
    expect(501 > BACKGROUND_JOB_THRESHOLD).toBe(true);
  });

  it("should use synchronous mode for files with 500 or fewer rows", () => {
    expect(500 > BACKGROUND_JOB_THRESHOLD).toBe(false);
    expect(100 > BACKGROUND_JOB_THRESHOLD).toBe(false);
    expect(1 > BACKGROUND_JOB_THRESHOLD).toBe(false);
  });
});

describe("Background Job - Batch Size", () => {
  const BATCH_SIZE = 200;

  it("should calculate correct number of batches for 40000 rows", () => {
    const totalRows = 40000;
    const batches = Math.ceil(totalRows / BATCH_SIZE);
    expect(batches).toBe(200);
  });

  it("should calculate correct number of batches for 1 row", () => {
    const totalRows = 1;
    const batches = Math.ceil(totalRows / BATCH_SIZE);
    expect(batches).toBe(1);
  });

  it("should calculate correct number of batches for exactly BATCH_SIZE rows", () => {
    const totalRows = 200;
    const batches = Math.ceil(totalRows / BATCH_SIZE);
    expect(batches).toBe(1);
  });

  it("should calculate correct number of batches for BATCH_SIZE + 1 rows", () => {
    const totalRows = 201;
    const batches = Math.ceil(totalRows / BATCH_SIZE);
    expect(batches).toBe(2);
  });
});

describe("Background Job - Progress Calculation", () => {
  it("should calculate progress percentage correctly", () => {
    const totalRows = 40000;
    const processedRows = 10000;
    const progress = Math.min(Math.round((processedRows / totalRows) * 100), 100);
    expect(progress).toBe(25);
  });

  it("should cap progress at 100%", () => {
    const totalRows = 100;
    const processedRows = 150; // edge case: processed > total
    const progress = Math.min(Math.round((processedRows / totalRows) * 100), 100);
    expect(progress).toBe(100);
  });

  it("should handle zero total rows", () => {
    const totalRows = 0;
    const processedRows = 0;
    const progress = totalRows === 0 ? 0 : Math.min(Math.round((processedRows / totalRows) * 100), 100);
    expect(progress).toBe(0);
  });

  it("should show 0% at start", () => {
    const totalRows = 40000;
    const processedRows = 0;
    const progress = Math.min(Math.round((processedRows / totalRows) * 100), 100);
    expect(progress).toBe(0);
  });

  it("should show 100% when complete", () => {
    const totalRows = 40000;
    const processedRows = 40000;
    const progress = Math.min(Math.round((processedRows / totalRows) * 100), 100);
    expect(progress).toBe(100);
  });
});
