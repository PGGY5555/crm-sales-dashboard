import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./db", () => ({
  getDb: vi.fn(),
}));

vi.mock("./storage", () => ({
  storageDelete: vi.fn(),
}));

import { getDb } from "./db";
import { storageDelete } from "./storage";
import { deleteImportStorageFile, purgeImportJobStorage } from "./clearImportStorage";

describe("clearImportStorage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deleteImportStorageFile skips empty keys", async () => {
    await deleteImportStorageFile("");
    expect(storageDelete).not.toHaveBeenCalled();
  });

  it("deleteImportStorageFile calls storageDelete", async () => {
    await deleteImportStorageFile("imports/1/file.xlsx");
    expect(storageDelete).toHaveBeenCalledWith("imports/1/file.xlsx");
  });

  it("purgeImportJobStorage deletes file and clears job refs", async () => {
    const update = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
    const mockDb = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ fileKey: "imports/json/1.json" }]),
          }),
        }),
      }),
      update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: update }) }),
    };
    vi.mocked(getDb).mockResolvedValue(mockDb as any);

    await purgeImportJobStorage(1);

    expect(storageDelete).toHaveBeenCalledWith("imports/json/1.json");
    expect(mockDb.update).toHaveBeenCalled();
  });
});
