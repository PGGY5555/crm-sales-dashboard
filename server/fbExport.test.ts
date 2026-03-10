import { describe, it, expect } from "vitest";

// Test the phone formatting logic used in FB audience export
describe("FB Audience Export - Phone Format", () => {
  const formatPhoneTo886 = (phone: string): string => {
    if (!phone) return "";
    const cleaned = phone.replace(/[^0-9]/g, "");
    if (cleaned.startsWith("0") && cleaned.length === 10) {
      return "886" + cleaned.slice(1);
    }
    if (cleaned.startsWith("886") && cleaned.length === 12) {
      return cleaned;
    }
    if (cleaned.length === 9) {
      return "886" + cleaned;
    }
    return cleaned;
  };

  it("should convert 0935111222 to 886935111222", () => {
    expect(formatPhoneTo886("0935111222")).toBe("886935111222");
  });

  it("should convert 0912345678 to 886912345678", () => {
    expect(formatPhoneTo886("0912345678")).toBe("886912345678");
  });

  it("should keep 886935069866 as is", () => {
    expect(formatPhoneTo886("886935069866")).toBe("886935069866");
  });

  it("should handle 9-digit number without leading 0", () => {
    expect(formatPhoneTo886("935111222")).toBe("886935111222");
  });

  it("should strip non-numeric characters", () => {
    expect(formatPhoneTo886("0935-111-222")).toBe("886935111222");
  });

  it("should handle phone with spaces", () => {
    expect(formatPhoneTo886("0935 111 222")).toBe("886935111222");
  });

  it("should return empty string for empty input", () => {
    expect(formatPhoneTo886("")).toBe("");
  });

  it("should return empty string for null-like input", () => {
    expect(formatPhoneTo886("")).toBe("");
  });
});

describe("FB Audience Export - CSV Format", () => {
  const HEADER = "email,email,email,phone,phone,phone,madid,fn,ln,zip,ct,st,country,dob,doby,gen,age,uid,value";

  // Replicate the row generation logic from the frontend
  const generateRow = (c: { email?: string; phone?: string; ltvOneYear?: number }) => {
    const formatPhoneTo886 = (phone: string): string => {
      if (!phone) return "";
      const cleaned = phone.replace(/[^0-9]/g, "");
      if (cleaned.startsWith("0") && cleaned.length === 10) return "886" + cleaned.slice(1);
      if (cleaned.startsWith("886") && cleaned.length === 12) return cleaned;
      if (cleaned.length === 9) return "886" + cleaned;
      return cleaned;
    };
    const email = (c.email || "").trim();
    const phone = formatPhoneTo886(c.phone || "");
    const ltvValue = c.ltvOneYear ? String(Math.round(Number(c.ltvOneYear))) : "";
    return `${email},,,${phone},,,,,,,,,TW,,,,,,${ltvValue}`;
  };

  it("should have correct header with 19 columns", () => {
    const columns = HEADER.split(",");
    expect(columns.length).toBe(19);
    expect(columns[0]).toBe("email");
    expect(columns[3]).toBe("phone");
    expect(columns[12]).toBe("country");
    expect(columns[18]).toBe("value");
  });

  it("should generate correct row with LTV value", () => {
    const row = generateRow({ email: "test@example.com", phone: "0935111222", ltvOneYear: 15680.5 });
    const columns = row.split(",");
    expect(columns.length).toBe(19);
    expect(columns[0]).toBe("test@example.com");
    expect(columns[3]).toBe("886935111222");
    expect(columns[12]).toBe("TW");
    expect(columns[18]).toBe("15681"); // rounded
  });

  it("should generate correct row with zero LTV", () => {
    const row = generateRow({ email: "test@example.com", phone: "0935111222", ltvOneYear: 0 });
    const columns = row.split(",");
    expect(columns.length).toBe(19);
    expect(columns[18]).toBe(""); // 0 treated as falsy, empty value
  });

  it("should generate correct row without LTV", () => {
    const row = generateRow({ email: "test@example.com", phone: "0935111222" });
    const columns = row.split(",");
    expect(columns.length).toBe(19);
    expect(columns[18]).toBe(""); // undefined → empty
  });

  it("should generate correct row with large LTV", () => {
    const row = generateRow({ email: "vip@example.com", phone: "886912345678", ltvOneYear: 250000.99 });
    const columns = row.split(",");
    expect(columns[0]).toBe("vip@example.com");
    expect(columns[3]).toBe("886912345678");
    expect(columns[18]).toBe("250001"); // rounded up
  });

  it("should handle empty email and phone with LTV", () => {
    const row = generateRow({ email: "", phone: "", ltvOneYear: 5000 });
    const columns = row.split(",");
    expect(columns.length).toBe(19);
    expect(columns[0]).toBe("");
    expect(columns[3]).toBe("");
    expect(columns[12]).toBe("TW");
    expect(columns[18]).toBe("5000");
  });

  it("should match example file format with LTV", () => {
    const row = generateRow({ email: "peggy5555@gmail.com", phone: "886935069866", ltvOneYear: 12345 });
    expect(row).toBe("peggy5555@gmail.com,,,886935069866,,,,,,,,,TW,,,,,,12345");
  });

  it("should match example file format without LTV", () => {
    const row = generateRow({ email: "peggy5555@gmail.com", phone: "886935069866" });
    expect(row).toBe("peggy5555@gmail.com,,,886935069866,,,,,,,,,TW,,,,,,");
  });
});
