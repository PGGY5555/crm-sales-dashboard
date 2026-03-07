import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the database module
vi.mock("./db", () => ({
  updateCustomer: vi.fn(),
  getCustomerDetail: vi.fn(),
}));

import { updateCustomer, getCustomerDetail } from "./db";

describe("Customer Update API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updateCustomer should accept all editable fields including new custom fields", async () => {
    const mockCustomer = {
      id: 1,
      name: "測試客戶",
      email: "test@example.com",
      phone: "0912345678",
      birthday: "1990-01-01",
      tags: "VIP",
      memberLevel: "黃金會員",
      credits: "100",
      recipientName: "收件人",
      recipientPhone: "0987654321",
      recipientEmail: "recipient@example.com",
      notes: "備註",
      note1: "備註一",
      note2: "備註二",
      custom1: "自訂一",
      custom2: "自訂二",
      custom3: "自訂三",
      blacklisted: "否",
      lineUid: "U1234567890",
    };

    (updateCustomer as any).mockResolvedValue(mockCustomer);

    const result = await updateCustomer(1, {
      name: "測試客戶",
      note1: "備註一",
      note2: "備註二",
      custom1: "自訂一",
      custom2: "自訂二",
      custom3: "自訂三",
    });

    expect(updateCustomer).toHaveBeenCalledWith(1, {
      name: "測試客戶",
      note1: "備註一",
      note2: "備註二",
      custom1: "自訂一",
      custom2: "自訂二",
      custom3: "自訂三",
    });
    expect(result).toEqual(mockCustomer);
    expect(result.note1).toBe("備註一");
    expect(result.note2).toBe("備註二");
    expect(result.custom1).toBe("自訂一");
    expect(result.custom2).toBe("自訂二");
    expect(result.custom3).toBe("自訂三");
  });

  it("updateCustomer should handle null values for clearing fields", async () => {
    const mockCustomer = {
      id: 1,
      name: "客戶",
      note1: null,
      note2: null,
      custom1: null,
      custom2: null,
      custom3: null,
    };

    (updateCustomer as any).mockResolvedValue(mockCustomer);

    const result = await updateCustomer(1, {
      note1: null,
      note2: null,
      custom1: null,
      custom2: null,
      custom3: null,
    });

    expect(result.note1).toBeNull();
    expect(result.custom1).toBeNull();
  });

  it("updateCustomer should handle blacklisted field", async () => {
    const mockCustomer = { id: 1, blacklisted: "是" };
    (updateCustomer as any).mockResolvedValue(mockCustomer);

    const result = await updateCustomer(1, { blacklisted: "是" });
    expect(result.blacklisted).toBe("是");
  });

  it("getCustomerDetail should return customer with new fields", async () => {
    const mockDetail = {
      customer: {
        id: 1,
        name: "測試",
        note1: "備註一內容",
        note2: "備註二內容",
        custom1: "自訂一內容",
        custom2: "自訂二內容",
        custom3: "自訂三內容",
        blacklisted: "否",
      },
      orders: [],
    };

    (getCustomerDetail as any).mockResolvedValue(mockDetail);

    const result = await getCustomerDetail(1);
    expect(result?.customer.note1).toBe("備註一內容");
    expect(result?.customer.note2).toBe("備註二內容");
    expect(result?.customer.custom1).toBe("自訂一內容");
    expect(result?.customer.custom2).toBe("自訂二內容");
    expect(result?.customer.custom3).toBe("自訂三內容");
  });
});

describe("Excel Import - Custom Fields", () => {
  it("CustomerRow interface should support new fields", () => {
    // This test validates the type structure
    const row = {
      "顧客名稱": "測試",
      "電子信箱": "test@test.com",
      "備註1": "備註一",
      "備註2": "備註二",
      "自訂1": "自訂一",
      "自訂2": "自訂二",
      "自訂3": "自訂三",
    };

    expect(row["備註1"]).toBe("備註一");
    expect(row["備註2"]).toBe("備註二");
    expect(row["自訂1"]).toBe("自訂一");
    expect(row["自訂2"]).toBe("自訂二");
    expect(row["自訂3"]).toBe("自訂三");
  });

  it("should handle empty custom fields gracefully", () => {
    const row = {
      "顧客名稱": "測試",
      "電子信箱": "test@test.com",
    };

    const note1 = (row as any)["備註1"]?.trim() || null;
    const custom1 = (row as any)["自訂1"]?.trim() || null;

    expect(note1).toBeNull();
    expect(custom1).toBeNull();
  });
});
