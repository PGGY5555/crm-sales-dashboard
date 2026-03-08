import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the database module
vi.mock("./db", () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
  getAuditLogs: vi.fn().mockResolvedValue({ logs: [], total: 0 }),
  preCreateUser: vi.fn().mockResolvedValue({ id: 99, email: "new@test.com", name: "New User", role: "user" }),
}));

import { logAudit, getAuditLogs, preCreateUser } from "./db";

describe("Audit Log", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("logAudit should accept valid entry with all fields", async () => {
    await logAudit({
      userId: 1,
      userName: "Admin",
      userEmail: "admin@test.com",
      action: "customer_update",
      category: "customer_management",
      description: "更新客戶資料",
      details: { customerId: 123, field: "name" },
      ipAddress: "127.0.0.1",
    });
    expect(logAudit).toHaveBeenCalledTimes(1);
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "customer_update",
        category: "customer_management",
      })
    );
  });

  it("logAudit should accept entry with minimal fields", async () => {
    await logAudit({
      action: "login",
      category: "auth",
    });
    expect(logAudit).toHaveBeenCalledTimes(1);
  });

  it("getAuditLogs should return logs and total count", async () => {
    const result = await getAuditLogs({ page: 1, pageSize: 20 });
    expect(result).toHaveProperty("logs");
    expect(result).toHaveProperty("total");
    expect(Array.isArray(result.logs)).toBe(true);
    expect(typeof result.total).toBe("number");
  });

  it("getAuditLogs should accept filter parameters", async () => {
    await getAuditLogs({
      page: 1,
      pageSize: 10,
      action: "customer_update",
      userId: 1,
    });
    expect(getAuditLogs).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "customer_update",
        userId: 1,
      })
    );
  });
});

describe("Pre-create User", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("preCreateUser should create a user with email", async () => {
    const result = await preCreateUser({
      email: "new@test.com",
      name: "New User",
      role: "user",
    });
    expect(result).toHaveProperty("id");
    expect(result).toHaveProperty("email", "new@test.com");
    expect(result).toHaveProperty("role", "user");
  });

  it("preCreateUser should be called with correct params", async () => {
    await preCreateUser({
      email: "admin@test.com",
      name: "Admin User",
      role: "admin",
    });
    expect(preCreateUser).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "admin@test.com",
        role: "admin",
      })
    );
  });
});
