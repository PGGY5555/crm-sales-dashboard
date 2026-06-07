import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type express from "express";
import { verifyCronSecret } from "./cronRoutes";

vi.mock("./db", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "./db";
import { syncCustomersToExternalApi } from "./cron";

function mockRequest(headers: Record<string, string>): express.Request {
  return { headers } as express.Request;
}

describe("verifyCronSecret", () => {
  const originalToken = process.env.CRON_SECRET_TOKEN;

  afterEach(() => {
    process.env.CRON_SECRET_TOKEN = originalToken;
  });

  it("accepts Bearer token", () => {
    process.env.CRON_SECRET_TOKEN = "test-secret";
    expect(
      verifyCronSecret(mockRequest({ authorization: "Bearer test-secret" })),
    ).toBe(true);
  });

  it("rejects x-cron-secret without Bearer", () => {
    process.env.CRON_SECRET_TOKEN = "test-secret";
    expect(
      verifyCronSecret(mockRequest({ "x-cron-secret": "test-secret" })),
    ).toBe(false);
  });

  it("rejects wrong token", () => {
    process.env.CRON_SECRET_TOKEN = "test-secret";
    expect(
      verifyCronSecret(mockRequest({ authorization: "Bearer wrong" })),
    ).toBe(false);
  });

  it("rejects when CRON_SECRET_TOKEN is unset", () => {
    delete process.env.CRON_SECRET_TOKEN;
    expect(
      verifyCronSecret(mockRequest({ authorization: "Bearer test-secret" })),
    ).toBe(false);
  });
});

describe("syncCustomersToExternalApi", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("skips when env vars are missing", async () => {
    delete process.env.EXTERNAL_TARGET_API_URL;
    delete process.env.SYNC_START_DATE;
    delete process.env.EXTERNAL_API_TOKEN;

    const result = await syncCustomersToExternalApi();
    expect(result.skipped).toBe(true);
    expect(result.sent).toBe(0);
  });

  it("posts each customer individually to HiEmail", async () => {
    process.env.EXTERNAL_TARGET_API_URL = "https://hiemail.sunreachx.com/api/v1/subscribers";
    process.env.SYNC_START_DATE = "2024-06-01";
    process.env.EXTERNAL_API_TOKEN = "hiemail-key";

    const select = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([
          { name: "Alice", email: "a@test.com" },
          { name: "Bob", email: "b@test.com" },
        ]),
      }),
    });
    (getDb as any).mockResolvedValue({ select });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "",
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await syncCustomersToExternalApi();

    expect(result.ok).toBe(true);
    expect(result.sent).toBe(2);
    expect(result.failed).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://hiemail.sunreachx.com/api/v1/subscribers",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer hiemail-key",
        },
        body: JSON.stringify({ name: "Alice", email: "a@test.com" }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://hiemail.sunreachx.com/api/v1/subscribers",
      expect.objectContaining({
        body: JSON.stringify({ name: "Bob", email: "b@test.com" }),
      }),
    );
  });

  it("continues syncing when a single POST fails", async () => {
    process.env.EXTERNAL_TARGET_API_URL = "https://hiemail.sunreachx.com/api/v1/subscribers";
    process.env.SYNC_START_DATE = "2024-06-01";
    process.env.EXTERNAL_API_TOKEN = "hiemail-key";

    const select = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([
          { name: "Bad", email: "bad@test.com" },
          { name: "Good", email: "good@test.com" },
        ]),
      }),
    });
    (getDb as any).mockResolvedValue({ select });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 422,
        text: async () => "invalid email",
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "",
      });
    vi.stubGlobal("fetch", fetchMock);

    const result = await syncCustomersToExternalApi();

    expect(result.ok).toBe(true);
    expect(result.sent).toBe(1);
    expect(result.failed).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
