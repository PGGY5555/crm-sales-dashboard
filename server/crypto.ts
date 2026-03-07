import crypto from "crypto";
import { ENV } from "./_core/env";

const ALGORITHM = "aes-256-cbc";

/**
 * Derive a 32-byte encryption key from JWT_SECRET using SHA-256.
 * This ensures we always have a valid key length for AES-256.
 */
function getEncryptionKey(): Buffer {
  const secret = ENV.cookieSecret || "fallback-secret-key-for-dev";
  return crypto.createHash("sha256").update(secret).digest();
}

/**
 * Encrypt a plaintext string using AES-256-CBC.
 * Returns the encrypted value and the IV (both as hex strings).
 */
export function encrypt(plaintext: string): { encrypted: string; iv: string } {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  return {
    encrypted,
    iv: iv.toString("hex"),
  };
}

/**
 * Decrypt an encrypted string using AES-256-CBC.
 */
export function decrypt(encryptedHex: string, ivHex: string): string {
  const key = getEncryptionKey();
  const iv = Buffer.from(ivHex, "hex");
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  let decrypted = decipher.update(encryptedHex, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

/**
 * Mask a token for display purposes.
 * Shows only the first 4 and last 4 characters.
 */
export function maskToken(token: string): string {
  if (token.length <= 8) {
    return "****";
  }
  return `${token.slice(0, 4)}****${token.slice(-4)}`;
}
