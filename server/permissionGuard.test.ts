import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";

vi.mock("./db", () => ({
  checkUserPermission: vi.fn(),
}));

import { checkUserPermission } from "./db";
import { assertPermission, assertAnyPermission } from "./permissionGuard";

describe("permissionGuard", () => {
  const user = { id: 1, role: "user" };
  const admin = { id: 2, role: "admin" };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("assertPermission passes when user has permission", async () => {
    vi.mocked(checkUserPermission).mockResolvedValue(true);
    await expect(assertPermission(user, "customer_mgmt")).resolves.toBeUndefined();
  });

  it("assertPermission throws FORBIDDEN when denied", async () => {
    vi.mocked(checkUserPermission).mockResolvedValue(false);
    await expect(assertPermission(user, "customer_mgmt")).rejects.toMatchObject({
      code: "FORBIDDEN",
    } satisfies Partial<TRPCError>);
  });

  it("assertAnyPermission passes if any key matches", async () => {
    vi.mocked(checkUserPermission)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    await expect(assertAnyPermission(user, ["dashboard", "customer_analysis"])).resolves.toBeUndefined();
  });

  it("assertAnyPermission throws when none match", async () => {
    vi.mocked(checkUserPermission).mockResolvedValue(false);
    await expect(assertAnyPermission(user, ["dashboard", "customer_analysis"])).rejects.toMatchObject({
      code: "FORBIDDEN",
    } satisfies Partial<TRPCError>);
  });

  it("admin still passes via checkUserPermission in db layer", async () => {
    vi.mocked(checkUserPermission).mockImplementation(async (_id, role) => role === "admin");
    await expect(assertPermission(admin, "customer_mgmt")).resolves.toBeUndefined();
  });
});
