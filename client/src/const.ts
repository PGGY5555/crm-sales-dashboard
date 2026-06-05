export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

/** Backend-initiated Google OAuth login URL (no client-side env required). */
export const getLoginUrl = () => "/api/auth/google";
