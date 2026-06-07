import { describe, expect, it } from "vitest";
import { getDefaultPermissions, type PermissionKey } from "../shared/permissions";
import { getDefaultRoute, isRouteAccessible } from "../shared/navRoutes";

function accessFrom(perms: Partial<Record<PermissionKey, boolean>>, isAdmin = false) {
  const defaults = getDefaultPermissions();
  const merged = { ...defaults, ...perms };
  return {
    isAdmin,
    hasPermission: (key: PermissionKey) => isAdmin || merged[key] === true,
  };
}

describe("navRoutes", () => {
  it("defaults to sync for typical employee without dashboard", () => {
    const access = accessFrom({ dashboard: false, data_sync: true });
    expect(getDefaultRoute(access)).toBe("/sync");
  });

  it("defaults to dashboard when permitted", () => {
    const access = accessFrom({ dashboard: true });
    expect(getDefaultRoute(access)).toBe("/");
  });

  it("falls back to account settings when no nav permissions", () => {
    const access = accessFrom(
      Object.fromEntries(
        Object.keys(getDefaultPermissions()).map((k) => [k, false])
      ) as Partial<Record<PermissionKey, boolean>>
    );
    expect(getDefaultRoute(access)).toBe("/account/settings");
  });

  it("blocks dashboard routes without permission", () => {
    const access = accessFrom({ dashboard: false, data_sync: true });
    expect(isRouteAccessible("/", access)).toBe(false);
    expect(isRouteAccessible("/trends", access)).toBe(false);
    expect(isRouteAccessible("/sync", access)).toBe(true);
  });
});
