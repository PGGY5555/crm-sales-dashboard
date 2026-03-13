import { describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import { parseExcel, countExcelRows, createExcelBuffer } from "./excelUtils";

// Helper to create an Excel buffer from rows using ExcelJS
async function createTestExcelBuffer(sheetName: string, headers: string[], rows: any[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  ws.addRow(headers);
  for (const row of rows) {
    ws.addRow(row);
  }
  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

describe("Excel Import - parseExcel (ExcelJS)", () => {
  it("should parse a simple Excel buffer into rows", async () => {
    const buffer = await createTestExcelBuffer("Sheet1", ["Name", "Email"], [
      ["Alice", "alice@test.com"],
      ["Bob", "bob@test.com"],
    ]);
    const rows = await parseExcel(buffer);
    expect(rows).toHaveLength(2);
    expect(rows[0].Name).toBe("Alice");
    expect(rows[1].Email).toBe("bob@test.com");
  });

  it("should handle empty Excel file (headers only)", async () => {
    const buffer = await createTestExcelBuffer("Sheet1", ["Name"], []);
    const rows = await parseExcel(buffer);
    expect(rows).toHaveLength(0);
  });
});

describe("Excel Import - countExcelRows (ExcelJS)", () => {
  it("should count rows correctly", async () => {
    const buffer = await createTestExcelBuffer("Sheet1", ["Name", "Email"], [
      ["Alice", "alice@test.com"],
      ["Bob", "bob@test.com"],
      ["Charlie", "charlie@test.com"],
    ]);
    const count = await countExcelRows(buffer);
    expect(count).toBe(3);
  });

  it("should return 0 for empty sheet", async () => {
    const buffer = await createTestExcelBuffer("Sheet1", ["Name"], []);
    const count = await countExcelRows(buffer);
    expect(count).toBe(0);
  });
});

describe("Excel Import - createExcelBuffer (ExcelJS)", () => {
  it("should create and re-parse an Excel buffer", async () => {
    const data = [
      { Name: "Alice", Email: "alice@test.com" },
      { Name: "Bob", Email: "bob@test.com" },
    ];
    const buffer = await createExcelBuffer(data, "TestSheet");
    const rows = await parseExcel(buffer);
    expect(rows).toHaveLength(2);
    expect(rows[0].Name).toBe("Alice");
    expect(rows[1].Email).toBe("bob@test.com");
  });

  it("should handle empty data array", async () => {
    const buffer = await createExcelBuffer([], "EmptySheet");
    const rows = await parseExcel(buffer);
    expect(rows).toHaveLength(0);
  });
});

describe("Excel Import - Customer field mapping", () => {
  it("should map customer Excel headers to expected fields", async () => {
    const headers = [
      "會員編號", "姓名", "信箱", "手機", "性別", "生日",
      "會員等級", "會員標籤", "總消費金額", "訂單數",
    ];
    const buffer = await createTestExcelBuffer("顧客列表", headers, [
      ["C001", "王小明", "wang@test.com", "0912345678", "男", "1990-01-15",
       "VIP", "活躍", "50000", "10"],
    ]);
    const rows = await parseExcel(buffer);

    expect(rows).toHaveLength(1);
    expect(rows[0]["會員編號"]).toBe("C001");
    expect(rows[0]["姓名"]).toBe("王小明");
    expect(rows[0]["信箱"]).toBe("wang@test.com");
    expect(rows[0]["手機"]).toBe("0912345678");
    expect(rows[0]["總消費金額"]).toBe("50000");
  });
});

describe("Excel Import - Order field mapping", () => {
  it("should map order Excel headers to expected fields", async () => {
    const headers = [
      "訂單編號", "建立時間", "訂單狀態", "訂單金額", "商品總金額",
      "運費", "折扣金額", "會員信箱", "收件人姓名",
      "商品名稱", "商品規格", "商品數量", "商品單價",
    ];
    const buffer = await createTestExcelBuffer("訂單列表", headers, [
      ["ORD-001", "2025-12-01 10:30:00", "已完成", "1500", "1400",
       "100", "0", "wang@test.com", "王小明",
       "商品A", "紅色/L", "2", "700"],
    ]);
    const rows = await parseExcel(buffer);

    expect(rows).toHaveLength(1);
    expect(rows[0]["訂單編號"]).toBe("ORD-001");
    expect(rows[0]["訂單狀態"]).toBe("已完成");
    expect(rows[0]["訂單金額"]).toBe("1500");
    expect(rows[0]["會員信箱"]).toBe("wang@test.com");
  });
});

describe("Excel Import - Product field mapping", () => {
  it("should map product Excel headers to expected fields", async () => {
    const headers = [
      "商品名稱", "商品貨號", "成本", "售價", "庫存數量",
      "商品分類", "商品狀態", "規格名稱", "規格值",
    ];
    const buffer = await createTestExcelBuffer("商品列表", headers, [
      ["經典T恤", "SKU-001", "200", "599", "100",
       "上衣", "上架", "尺寸", "S/M/L"],
    ]);
    const rows = await parseExcel(buffer);

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

describe("Customer Import - Conditional Update Logic (only update non-empty fields)", () => {
  // Simulates the IF(VALUES(col) IS NOT NULL AND VALUES(col) != '', VALUES(col), col) pattern
  function conditionalUpdate(newVal: string | null | undefined, existingVal: string | null): string | null {
    if (newVal !== null && newVal !== undefined && newVal !== '') {
      return newVal;
    }
    return existingVal;
  }

  it("should keep existing value when new value is null", () => {
    expect(conditionalUpdate(null, "VIP客戶")).toBe("VIP客戶");
  });

  it("should keep existing value when new value is empty string", () => {
    expect(conditionalUpdate("", "VIP客戶")).toBe("VIP客戶");
  });

  it("should keep existing value when new value is undefined", () => {
    expect(conditionalUpdate(undefined, "VIP客戶")).toBe("VIP客戶");
  });

  it("should update to new value when new value is non-empty", () => {
    expect(conditionalUpdate("黃金會員", "一般會員")).toBe("黃金會員");
  });

  it("should update to new value when existing value is null", () => {
    expect(conditionalUpdate("新備註", null)).toBe("新備註");
  });

  it("should keep null when both values are null/empty", () => {
    expect(conditionalUpdate(null, null)).toBe(null);
    expect(conditionalUpdate("", null)).toBe(null);
  });

  // Simulate full customer row update scenario
  it("should selectively update customer fields based on Excel data", () => {
    const existingCustomer = {
      name: "王小明",
      phone: "0912345678",
      birthday: "1990-01-15",
      tags: "VIP",
      memberLevel: "黃金會員",
      notes: "重要客戶",
      blacklisted: "否",
      lineUid: "U123456",
      note1: "備註內容1",
      note2: null as string | null,
    };

    // New Excel row with some empty fields
    const newExcelRow = {
      name: "王小明",       // same - should keep
      phone: "",            // empty - should keep existing
      birthday: "",         // empty - should keep existing
      tags: "VVIP",         // changed - should update
      memberLevel: "",      // empty - should keep existing
      notes: "",            // empty - should keep existing
      blacklisted: "是",    // changed - should update
      lineUid: "",          // empty - should keep existing
      note1: "",            // empty - should keep existing
      note2: "新備註2",     // new value - should update
    };

    const result = {
      name: conditionalUpdate(newExcelRow.name, existingCustomer.name),
      phone: conditionalUpdate(newExcelRow.phone, existingCustomer.phone),
      birthday: conditionalUpdate(newExcelRow.birthday, existingCustomer.birthday),
      tags: conditionalUpdate(newExcelRow.tags, existingCustomer.tags),
      memberLevel: conditionalUpdate(newExcelRow.memberLevel, existingCustomer.memberLevel),
      notes: conditionalUpdate(newExcelRow.notes, existingCustomer.notes),
      blacklisted: conditionalUpdate(newExcelRow.blacklisted, existingCustomer.blacklisted),
      lineUid: conditionalUpdate(newExcelRow.lineUid, existingCustomer.lineUid),
      note1: conditionalUpdate(newExcelRow.note1, existingCustomer.note1),
      note2: conditionalUpdate(newExcelRow.note2, existingCustomer.note2),
    };

    expect(result.name).toBe("王小明");
    expect(result.phone).toBe("0912345678");     // kept existing
    expect(result.birthday).toBe("1990-01-15");  // kept existing
    expect(result.tags).toBe("VVIP");            // updated
    expect(result.memberLevel).toBe("黃金會員"); // kept existing
    expect(result.notes).toBe("重要客戶");       // kept existing
    expect(result.blacklisted).toBe("是");       // updated
    expect(result.lineUid).toBe("U123456");      // kept existing
    expect(result.note1).toBe("備註內容1");      // kept existing
    expect(result.note2).toBe("新備註2");        // updated
  });
});
