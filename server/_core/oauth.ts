import crypto from "crypto";
import { OAuth2Client } from "google-auth-library";
import { parse as parseCookieHeader } from "cookie";
import { COOKIE_NAME, ONE_YEAR_MS, PENDING_2FA_COOKIE_NAME, PENDING_2FA_MS } from "@shared/const";
import type { Express, Request, Response } from "express";
import { getUserByOpenId, loginWithGoogleUser } from "../db";
import { getOAuthStateCookieOptions, getSessionCookieOptions } from "./cookies";
import { ENV } from "./env";
import { sdk } from "./sdk";

const OAUTH_STATE_COOKIE = "oauth_state";

function getQueryParam(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
}

function resolveRedirectUri(req: Request): string {
  // When set, always use the env value — never assemble dynamically (Cloud Run / Google Console must match exactly).
  if (ENV.googleRedirectUri) {
    return ENV.googleRedirectUri;
  }

  const proto =
    (req.headers["x-forwarded-proto"] as string | undefined)
      ?.split(",")[0]
      ?.trim() || req.protocol;
  const host =
    (req.headers["x-forwarded-host"] as string | undefined)
      ?.split(",")[0]
      ?.trim() || req.get("host");

  return `${proto}://${host}/api/auth/google/callback`;
}

function createOAuthClient(req: Request): OAuth2Client {
  return new OAuth2Client(
    ENV.googleClientId,
    ENV.googleClientSecret,
    resolveRedirectUri(req)
  );
}

export function registerAuthRoutes(app: Express) {
  app.get("/api/auth/google", (req: Request, res: Response) => {
    if (!ENV.googleClientId || !ENV.googleClientSecret) {
      res.status(500).json({
        error: "Google OAuth 未設定，請設定 GOOGLE_CLIENT_ID 與 GOOGLE_CLIENT_SECRET",
      });
      return;
    }

    const state = crypto.randomBytes(32).toString("hex");
    const oauth2Client = createOAuthClient(req);
    const authorizeUrl = oauth2Client.generateAuthUrl({
      access_type: "online",
      scope: ["openid", "email", "profile"],
      state,
      prompt: "select_account",
    });

    const oauthCookieOptions = getOAuthStateCookieOptions(req);
    console.log("[Google OAuth] Setting state cookie", {
      sameSite: oauthCookieOptions.sameSite,
      secure: oauthCookieOptions.secure,
      path: oauthCookieOptions.path,
      nodeEnv: process.env.NODE_ENV,
      state,
    });
    res.cookie(OAUTH_STATE_COOKIE, state, {
      ...oauthCookieOptions,
      maxAge: 10 * 60 * 1000,
    });

    res.redirect(302, authorizeUrl);
  });

  app.get("/api/auth/google/callback", async (req: Request, res: Response) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");
    const error = getQueryParam(req, "error");
    const cookieOptions = getSessionCookieOptions(req);
    const oauthCookieOptions = getOAuthStateCookieOptions(req);

    if (error) {
      console.error("[Google OAuth] User denied consent:", error);
      res.status(400).json({ error: "Google 登入已取消" });
      return;
    }

    if (!code || !state) {
      res.status(400).json({ error: "缺少 code 或 state 參數" });
      return;
    }

    const cookies = parseCookieHeader(req.headers.cookie || "");
    const savedState = cookies[OAUTH_STATE_COOKIE];

    console.log("[Google OAuth] State check", {
      queryState: state,
      cookieState: savedState ?? "(missing)",
      match: savedState === state,
      cookieHeader: req.headers.cookie ?? "(none)",
      oauthCookieOptions,
    });

    if (!savedState || savedState !== state) {
      res.clearCookie(OAUTH_STATE_COOKIE, { ...oauthCookieOptions, maxAge: -1 });
      res.status(400).json({ error: "OAuth state 驗證失敗" });
      return;
    }

    res.clearCookie(OAUTH_STATE_COOKIE, { ...oauthCookieOptions, maxAge: -1 });

    if (!ENV.googleClientId || !ENV.googleClientSecret) {
      res.status(500).json({ error: "Google OAuth 未設定" });
      return;
    }

    try {
      const redirectUri = resolveRedirectUri(req);
      const oauth2Client = createOAuthClient(req);
      const { tokens } = await oauth2Client.getToken({
        code,
        redirect_uri: redirectUri,
      });

      if (!tokens.id_token) {
        res.status(400).json({ error: "Google 未回傳 id_token" });
        return;
      }

      const ticket = await oauth2Client.verifyIdToken({
        idToken: tokens.id_token,
        audience: ENV.googleClientId,
      });
      const payload = ticket.getPayload();

      if (!payload?.sub) {
        res.status(400).json({ error: "無法取得 Google 使用者 ID" });
        return;
      }

      const profile = {
        openId: payload.sub,
        email: payload.email ?? null,
        name: payload.name ?? null,
      };

      await loginWithGoogleUser(profile);

      const user = await getUserByOpenId(profile.openId);

      if (user?.twoFactorEnabled) {
        const pendingToken = await sdk.createPending2FAToken(profile.openId, {
          name: profile.name || user.name || "",
          email: profile.email ?? user.email ?? undefined,
        });

        res.cookie(PENDING_2FA_COOKIE_NAME, pendingToken, {
          ...cookieOptions,
          maxAge: PENDING_2FA_MS,
        });

        res.redirect(302, "/auth/2fa");
        return;
      }

      const sessionToken = await sdk.createSessionToken(profile.openId, {
        name: profile.name || "",
        email: profile.email ?? undefined,
        expiresInMs: ONE_YEAR_MS,
      });

      res.cookie(COOKIE_NAME, sessionToken, {
        ...cookieOptions,
        maxAge: ONE_YEAR_MS,
      });

      res.redirect(302, "/");
    } catch (err) {
      console.error("Google OAuth Error:", err);
      const details = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: "Google 登入失敗", details });
    }
  });
}

/** @deprecated Use registerAuthRoutes */
export const registerOAuthRoutes = registerAuthRoutes;
