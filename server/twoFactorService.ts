import { eq } from "drizzle-orm";
import { users } from "../drizzle/schema";
import { getDb } from "./db";
import {
  createTwoFactorSetup,
  decryptStoredTwoFactorSecret,
  verifyTotpCode,
} from "./twoFactor";

export async function getTwoFactorStatus(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [user] = await db
    .select({
      twoFactorEnabled: users.twoFactorEnabled,
      twoFactorSecret: users.twoFactorSecret,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) throw new Error("User not found");

  return {
    enabled: user.twoFactorEnabled,
    pendingSetup: Boolean(user.twoFactorSecret && !user.twoFactorEnabled),
  };
}

export async function generateTwoFactorForUser(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      twoFactorEnabled: users.twoFactorEnabled,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) throw new Error("User not found");
  if (user.twoFactorEnabled) {
    throw new Error("2FA 已啟用，請先停用後再重新設定");
  }

  const setup = await createTwoFactorSetup(user.email, user.name);

  await db
    .update(users)
    .set({
      twoFactorSecret: setup.encryptedSecret,
      twoFactorEnabled: false,
    })
    .where(eq(users.id, userId));

  return {
    qrCodeDataUrl: setup.qrCodeDataUrl,
    manualEntryKey: setup.manualEntryKey,
  };
}

export async function verifyAndEnableTwoFactorForUser(userId: number, token: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [user] = await db
    .select({
      twoFactorSecret: users.twoFactorSecret,
      twoFactorEnabled: users.twoFactorEnabled,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) throw new Error("User not found");
  if (user.twoFactorEnabled) {
    return { success: true, alreadyEnabled: true };
  }
  if (!user.twoFactorSecret) {
    throw new Error("請先產生 2FA QR Code");
  }

  const secret = decryptStoredTwoFactorSecret(user.twoFactorSecret);
  if (!secret || !verifyTotpCode(secret, token)) {
    throw new Error("驗證碼錯誤，請重試");
  }

  await db.update(users).set({ twoFactorEnabled: true }).where(eq(users.id, userId));
  return { success: true, alreadyEnabled: false };
}

export async function disableTwoFactorForUser(userId: number, token: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [user] = await db
    .select({
      twoFactorSecret: users.twoFactorSecret,
      twoFactorEnabled: users.twoFactorEnabled,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user?.twoFactorEnabled || !user.twoFactorSecret) {
    throw new Error("2FA 尚未啟用");
  }

  const secret = decryptStoredTwoFactorSecret(user.twoFactorSecret);
  if (!secret || !verifyTotpCode(secret, token)) {
    throw new Error("驗證碼錯誤，無法停用 2FA");
  }

  await db
    .update(users)
    .set({
      twoFactorEnabled: false,
      twoFactorSecret: null,
    })
    .where(eq(users.id, userId));

  return { success: true };
}

export async function verifyTwoFactorLogin(openId: string, token: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [user] = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  if (!user?.twoFactorEnabled || !user.twoFactorSecret) {
    throw new Error("此帳號未啟用 2FA");
  }

  const secret = decryptStoredTwoFactorSecret(user.twoFactorSecret);
  if (!secret || !verifyTotpCode(secret, token)) {
    throw new Error("驗證碼錯誤");
  }

  return user;
}
