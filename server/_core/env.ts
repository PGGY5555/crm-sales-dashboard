export const ENV = {
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
  googleRedirectUri: process.env.GOOGLE_REDIRECT_URI ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  ownerEmail: process.env.OWNER_EMAIL ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
};

export function isOwnerAccount(profile: {
  openId: string;
  email?: string | null;
}): boolean {
  if (ENV.ownerOpenId && profile.openId === ENV.ownerOpenId) {
    return true;
  }
  if (
    ENV.ownerEmail &&
    profile.email &&
    profile.email.toLowerCase() === ENV.ownerEmail.toLowerCase()
  ) {
    return true;
  }
  return false;
}
