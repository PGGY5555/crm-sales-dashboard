import { describe, it, expect } from "vitest";
import {
  PERMISSION_KEYS,
  PERMISSION_GROUPS,
  getDefaultPermissions,
  getAllPermissions,
  type PermissionKey,
} from "../shared/permissions";

describe("Permission definitions", () => {
  it("should have all permission keys as non-empty strings", () => {
    expect(PERMISSION_KEYS.length).toBeGreaterThan(0);
    for (const key of PERMISSION_KEYS) {
      expect(typeof key).toBe("string");
      expect(key.length).toBeGreaterThan(0);
    }
  });

  it("should have unique permission keys", () => {
    const unique = new Set(PERMISSION_KEYS);
    expect(unique.size).toBe(PERMISSION_KEYS.length);
  });

  it("should have all group children keys in PERMISSION_KEYS", () => {
    for (const group of PERMISSION_GROUPS) {
      for (const child of group.children) {
        expect(PERMISSION_KEYS).toContain(child.key);
      }
    }
  });

  it("should cover all PERMISSION_KEYS in groups", () => {
    const groupKeys = new Set<string>();
    for (const group of PERMISSION_GROUPS) {
      for (const child of group.children) {
        groupKeys.add(child.key);
      }
    }
    for (const key of PERMISSION_KEYS) {
      expect(groupKeys.has(key)).toBe(true);
    }
  });

  it("getDefaultPermissions should enable data_sync, excel imports, and api sync by default", () => {
    const defaults = getDefaultPermissions();
    // These should be enabled by default for regular users
    const expectedEnabled: PermissionKey[] = [
      "data_sync",
      "excel_import_customers",
      "excel_import_orders",
      "excel_import_products",
      "excel_import_logistics",
      "api_sync_execute",
      "api_sync_status",
    ];
    for (const key of expectedEnabled) {
      expect(defaults[key]).toBe(true);
    }
    // These should remain disabled by default
    const expectedDisabled: PermissionKey[] = [
      "dashboard",
      "funnel",
      "customer_analysis",
      "customer_mgmt",
      "customer_mgmt_delete",
      "customer_mgmt_export",
      "order_mgmt",
      "order_mgmt_delete",
      "order_mgmt_export",
      "ai_chat",
      "excel_clear_data",
      "api_credentials",
    ];
    for (const key of expectedDisabled) {
      expect(defaults[key]).toBe(false);
    }
  });

  it("getAllPermissions should return all true", () => {
    const all = getAllPermissions();
    for (const key of PERMISSION_KEYS) {
      expect(all[key]).toBe(true);
    }
  });

  it("should have expected permission groups", () => {
    const groupLabels = PERMISSION_GROUPS.map((g) => g.label);
    expect(groupLabels).toContain("儀表板總覽");
    expect(groupLabels).toContain("銷售漏斗");
    expect(groupLabels).toContain("客戶分析");
    expect(groupLabels).toContain("客戶資料管理");
    expect(groupLabels).toContain("訂單資料管理");
    expect(groupLabels).toContain("AI 洞察");
    expect(groupLabels).toContain("數據同步");
    expect(groupLabels).toContain("Excel 匯入");
    expect(groupLabels).toContain("API 同步");
  });

  it("customer_mgmt group should have delete and export sub-permissions", () => {
    const group = PERMISSION_GROUPS.find((g) => g.key === "customer_mgmt_group");
    expect(group).toBeDefined();
    const childKeys = group!.children.map((c) => c.key);
    expect(childKeys).toContain("customer_mgmt");
    expect(childKeys).toContain("customer_mgmt_delete");
    expect(childKeys).toContain("customer_mgmt_export");
  });

  it("order_mgmt group should have delete and export sub-permissions", () => {
    const group = PERMISSION_GROUPS.find((g) => g.key === "order_mgmt_group");
    expect(group).toBeDefined();
    const childKeys = group!.children.map((c) => c.key);
    expect(childKeys).toContain("order_mgmt");
    expect(childKeys).toContain("order_mgmt_delete");
    expect(childKeys).toContain("order_mgmt_export");
  });

  it("excel group should have all upload sub-permissions and clear data", () => {
    const group = PERMISSION_GROUPS.find((g) => g.key === "excel_group");
    expect(group).toBeDefined();
    const childKeys = group!.children.map((c) => c.key);
    expect(childKeys).toContain("excel_import_customers");
    expect(childKeys).toContain("excel_import_orders");
    expect(childKeys).toContain("excel_import_products");
    expect(childKeys).toContain("excel_import_logistics");
    expect(childKeys).toContain("excel_clear_data");
  });

  it("api group should have credentials, execute, and status sub-permissions", () => {
    const group = PERMISSION_GROUPS.find((g) => g.key === "api_group");
    expect(group).toBeDefined();
    const childKeys = group!.children.map((c) => c.key);
    expect(childKeys).toContain("api_credentials");
    expect(childKeys).toContain("api_sync_execute");
    expect(childKeys).toContain("api_sync_status");
  });
});
