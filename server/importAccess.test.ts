import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./db", () => ({
  getDb: vi.fn(),
  checkUserPermission: vi.fn(),
}));

import { getDb, checkUserPermission } from "./db";
import {
  canAccessImportJob,
  verifyImportFileTypePermission,
  verifyImportJobAccess,
} from "./importAccess";

describe("importAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("canAccessImportJob allows owner and admin", () => {
    expect(canAccessImportJob({ userId: 5 }, 5, "user")).toBe(true);
    expect(canAccessImportJob({ userId: 5 }, 9, "admin")).toBe(true);
    expect(canAccessImportJob({ userId: 5 }, 9, "user")).toBe(false);
  });

  it("verifyImportFileTypePermission rejects unknown file type", async () => {
    const result = await verifyImportFileTypePermission(1, "user", "unknown");
    expect(result).toEqual({ ok: false, status: 400, error: "不支援的檔案類型" });
  });

  it("verifyImportFileTypePermission rejects missing permission", async () => {
    vi.mocked(checkUserPermission).mockResolvedValue(false);
    const result = await verifyImportFileTypePermission(1, "user", "customers");
    expect(result).toEqual({ ok: false, status: 403, error: "您沒有執行此匯入操作的權限" });
  });

  it("verifyImportJobAccess rejects foreign job", async () => {
    vi.mocked(getDb).mockResolvedValue({
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{
            id: 1,
            userId: 99,
            fileType: "customers",
          }]),
        }),
      }),
    } as any);

    const result = await verifyImportJobAccess(1, 1, "user");
    expect(result).toEqual({ ok: false, status: 403, error: "您沒有權限操作此匯入任務" });
  });

  it("verifyImportJobAccess rejects mismatched file type", async () => {
    vi.mocked(getDb).mockResolvedValue({
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{
            id: 1,
            userId: 1,
            fileType: "customers",
          }]),
        }),
      }),
    } as any);
    vi.mocked(checkUserPermission).mockResolvedValue(true);

    const result = await verifyImportJobAccess(1, 1, "user", "orders");
    expect(result).toEqual({ ok: false, status: 400, error: "任務類型與請求不符" });
  });
});
