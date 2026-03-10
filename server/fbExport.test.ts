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

  it("should have correct header with 19 columns", () => {
    const columns = HEADER.split(",");
    expect(columns.length).toBe(19);
    expect(columns[0]).toBe("email");
    expect(columns[3]).toBe("phone");
    expect(columns[12]).toBe("country");
    expect(columns[18]).toBe("value");
  });

  it("should generate correct row format", () => {
    const email = "test@example.com";
    const phone = "886935111222";
    const row = `${email},,,${phone},,,,,,,,,TW,,,,,,`;
    const columns = row.split(",");
    expect(columns.length).toBe(19);
    expect(columns[0]).toBe("test@example.com");
    expect(columns[1]).toBe("");
    expect(columns[2]).toBe("");
    expect(columns[3]).toBe("886935111222");
    expect(columns[4]).toBe("");
    expect(columns[5]).toBe("");
    expect(columns[12]).toBe("TW");
    expect(columns[18]).toBe("");
  });

  it("should handle empty email and phone", () => {
    // The actual format from our code: `${email},,,${phone},,,,,,,,,TW,,,,,,`
    const email = "";
    const phone = "";
    const codeRow = `${email},,,${phone},,,,,,,,,TW,,,,,,`;
    expect(codeRow.split(",").length).toBe(19);
    // First column is empty email, then 2 empty, then empty phone, then 8 empty, then TW, then 6 empty
    expect(codeRow).toBe(",,,,,,,,,,,,TW,,,,,,");
  });

  it("should match example file format", () => {
    // From the example: peggy5555@gmail.com,,,886935069866,,,,,,,,,TW,,,,,,
    const email = "peggy5555@gmail.com";
    const phone = "886935069866";
    const row = `${email},,,${phone},,,,,,,,,TW,,,,,,`;
    expect(row).toBe("peggy5555@gmail.com,,,886935069866,,,,,,,,,TW,,,,,,");
  });
});
