import { generateSecret, generateURI, verifySync } from "otplib";
import QRCode from "qrcode";
import { encrypt, decrypt } from "./crypto";

const APP_NAME = "CRM 銷售分析儀表板";
const TOTP_EPOCH_TOLERANCE = 1;

function packEncryptedSecret(plainSecret: string): string {
  const { encrypted, iv } = encrypt(plainSecret);
  return `${iv}:${encrypted}`;
}

function unpackEncryptedSecret(stored: string): string {
  const sep = stored.indexOf(":");
  if (sep <= 0) {
    throw new Error("Invalid 2FA secret format");
  }
  const iv = stored.slice(0, sep);
  const encrypted = stored.slice(sep + 1);
  return decrypt(encrypted, iv);
}

export function verifyTotpCode(secret: string, token: string): boolean {
  const normalized = token.replace(/\s/g, "");
  if (!/^\d{6}$/.test(normalized)) {
    return false;
  }
  return verifySync({
    secret,
    token: normalized,
    epochTolerance: TOTP_EPOCH_TOLERANCE,
  }).valid;
}

export async function createTwoFactorSetup(email: string | null, name: string | null) {
  const secret = generateSecret();
  const label = email || name || "user";
  const otpauthUrl = generateURI({
    issuer: APP_NAME,
    label,
    secret,
  });
  const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);

  return {
    secret,
    encryptedSecret: packEncryptedSecret(secret),
    qrCodeDataUrl,
    manualEntryKey: secret,
  };
}

export function decryptStoredTwoFactorSecret(stored: string | null | undefined): string | null {
  if (!stored) return null;
  try {
    return unpackEncryptedSecret(stored);
  } catch {
    return null;
  }
}

export function encryptTwoFactorSecret(plainSecret: string): string {
  return packEncryptedSecret(plainSecret);
}
