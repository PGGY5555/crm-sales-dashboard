import { describe, expect, it } from "vitest";
import { generateSync, generateSecret } from "otplib";
import {
  createTwoFactorSetup,
  decryptStoredTwoFactorSecret,
  verifyTotpCode,
} from "./twoFactor";

describe("twoFactor", () => {
  it("creates setup with QR data URL and encrypts secret at rest", async () => {
    const setup = await createTwoFactorSetup("user@example.com", "Test User");

    expect(setup.secret).toBeTruthy();
    expect(setup.qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(setup.manualEntryKey).toBe(setup.secret);
    expect(setup.encryptedSecret).toContain(":");

    const decrypted = decryptStoredTwoFactorSecret(setup.encryptedSecret);
    expect(decrypted).toBe(setup.secret);
  });

  it("verifies a valid TOTP code", () => {
    const secret = generateSecret();
    const token = generateSync({ secret });
    expect(verifyTotpCode(secret, token)).toBe(true);
  });

  it("rejects invalid token format", () => {
    const secret = generateSecret();
    expect(verifyTotpCode(secret, "abc")).toBe(false);
    expect(verifyTotpCode(secret, "12345")).toBe(false);
  });

  it("rejects wrong TOTP code", () => {
    const secret = generateSecret();
    expect(verifyTotpCode(secret, "000000")).toBe(false);
  });
});
