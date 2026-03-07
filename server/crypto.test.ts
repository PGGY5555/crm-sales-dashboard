import { describe, expect, it } from "vitest";
import { encrypt, decrypt, maskToken } from "./crypto";

describe("encrypt / decrypt", () => {
  it("encrypts and decrypts a string correctly", () => {
    const plaintext = "my-secret-api-token-12345";
    const { encrypted, iv } = encrypt(plaintext);

    expect(encrypted).toBeTruthy();
    expect(iv).toBeTruthy();
    expect(encrypted).not.toBe(plaintext);

    const decrypted = decrypt(encrypted, iv);
    expect(decrypted).toBe(plaintext);
  });

  it("produces different ciphertext for the same plaintext (random IV)", () => {
    const plaintext = "same-input";
    const result1 = encrypt(plaintext);
    const result2 = encrypt(plaintext);

    expect(result1.encrypted).not.toBe(result2.encrypted);
    expect(result1.iv).not.toBe(result2.iv);

    // Both should decrypt to the same value
    expect(decrypt(result1.encrypted, result1.iv)).toBe(plaintext);
    expect(decrypt(result2.encrypted, result2.iv)).toBe(plaintext);
  });

  it("handles empty string", () => {
    const { encrypted, iv } = encrypt("");
    expect(decrypt(encrypted, iv)).toBe("");
  });

  it("handles long strings", () => {
    const longString = "a".repeat(10000);
    const { encrypted, iv } = encrypt(longString);
    expect(decrypt(encrypted, iv)).toBe(longString);
  });

  it("handles unicode characters", () => {
    const unicode = "你好世界 🌍 API金鑰";
    const { encrypted, iv } = encrypt(unicode);
    expect(decrypt(encrypted, iv)).toBe(unicode);
  });

  it("throws on wrong IV", () => {
    const { encrypted } = encrypt("test");
    const wrongIv = "00".repeat(16);
    expect(() => decrypt(encrypted, wrongIv)).toThrow();
  });
});

describe("maskToken", () => {
  it("masks a normal length token", () => {
    expect(maskToken("sk-1234567890abcdef")).toBe("sk-1****cdef");
  });

  it("masks a short token (<=8 chars)", () => {
    expect(maskToken("short")).toBe("****");
    expect(maskToken("12345678")).toBe("****");
  });

  it("masks a 9-char token", () => {
    expect(maskToken("123456789")).toBe("1234****6789");
  });
});
