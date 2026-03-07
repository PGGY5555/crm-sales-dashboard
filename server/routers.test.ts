import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import { COOKIE_NAME } from "../shared/const";
import type { TrpcContext } from "./_core/context";

type CookieCall = {
  name: string;
  options: Record<string, unknown>;
};

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(): { ctx: TrpcContext; clearedCookies: CookieCall[] } {
  const clearedCookies: CookieCall[] = [];

  const user: AuthenticatedUser = {
    id: 1,
    openId: "sample-user",
    email: "sample@example.com",
    name: "Sample User",
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  const ctx: TrpcContext = {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: (name: string, options: Record<string, unknown>) => {
        clearedCookies.push({ name, options });
      },
    } as TrpcContext["res"],
  };

  return { ctx, clearedCookies };
}

function createUnauthContext(): TrpcContext {
  return {
    user: null,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as TrpcContext["res"],
  };
}

describe("auth.logout", () => {
  it("clears the session cookie and reports success", async () => {
    const { ctx, clearedCookies } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.auth.logout();

    expect(result).toEqual({ success: true });
    expect(clearedCookies).toHaveLength(1);
    expect(clearedCookies[0]?.name).toBe(COOKIE_NAME);
    expect(clearedCookies[0]?.options).toMatchObject({
      maxAge: -1,
      secure: true,
      sameSite: "none",
      httpOnly: true,
      path: "/",
    });
  });
});

describe("auth.me", () => {
  it("returns user when authenticated", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.auth.me();
    expect(result).toBeTruthy();
    expect(result?.name).toBe("Sample User");
  });

  it("returns null when not authenticated", async () => {
    const ctx = createUnauthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.auth.me();
    expect(result).toBeNull();
  });
});

describe("dashboard routes require auth", () => {
  it("dashboard.kpi throws UNAUTHORIZED for unauthenticated user", async () => {
    const ctx = createUnauthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.dashboard.kpi()).rejects.toThrow();
  });

  it("dashboard.trend throws UNAUTHORIZED for unauthenticated user", async () => {
    const ctx = createUnauthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.dashboard.trend()).rejects.toThrow();
  });

  it("dashboard.funnel throws UNAUTHORIZED for unauthenticated user", async () => {
    const ctx = createUnauthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.dashboard.funnel()).rejects.toThrow();
  });

  it("dashboard.salesReps throws UNAUTHORIZED for unauthenticated user", async () => {
    const ctx = createUnauthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.dashboard.salesReps()).rejects.toThrow();
  });

  it("dashboard.lifecycle throws UNAUTHORIZED for unauthenticated user", async () => {
    const ctx = createUnauthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.dashboard.lifecycle()).rejects.toThrow();
  });

  it("dashboard.customers throws UNAUTHORIZED for unauthenticated user", async () => {
    const ctx = createUnauthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.dashboard.customers()).rejects.toThrow();
  });
});

describe("settings routes require admin", () => {
  it("settings.getCredentials throws FORBIDDEN for non-admin user", async () => {
    const { ctx } = createAuthContext(); // role = "user"
    const caller = appRouter.createCaller(ctx);
    await expect(caller.settings.getCredentials()).rejects.toThrow(/\u50c5\u7ba1\u7406\u54e1/);
  });

  it("settings.saveCredentials throws FORBIDDEN for non-admin user", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.settings.saveCredentials({ apiToken: "test", appName: "test" })
    ).rejects.toThrow(/\u50c5\u7ba1\u7406\u54e1/);
  });

  it("settings.getCredentials throws UNAUTHORIZED for unauthenticated user", async () => {
    const ctx = createUnauthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.settings.getCredentials()).rejects.toThrow();
  });
});

describe("sync routes require admin", () => {
  it("sync.trigger throws FORBIDDEN for non-admin user", async () => {
    const { ctx } = createAuthContext(); // role = "user"
    const caller = appRouter.createCaller(ctx);
    await expect(caller.sync.trigger()).rejects.toThrow(/\u50c5\u7ba1\u7406\u54e1/);
  });

  it("sync.trigger throws UNAUTHORIZED for unauthenticated user", async () => {
    const ctx = createUnauthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.sync.trigger()).rejects.toThrow();
  });
});

describe("router structure", () => {
  it("has all expected route namespaces", () => {
    const caller = appRouter.createCaller(createUnauthContext());
    expect(caller.auth).toBeDefined();
    expect(caller.dashboard).toBeDefined();
    expect(caller.sync).toBeDefined();
    expect(caller.ai).toBeDefined();
    expect(caller.system).toBeDefined();
    expect(caller.settings).toBeDefined();
  });
});
