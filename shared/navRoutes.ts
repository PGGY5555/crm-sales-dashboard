import type { PermissionKey } from "./permissions";

export type NavItemConfig = {
  path: string;
  adminOnly?: boolean;
  permKey?: PermissionKey;
};

/** Sidebar route order — also used to pick the default landing page. */
export const NAV_ITEMS: NavItemConfig[] = [
  { path: "/", permKey: "dashboard" },
  { path: "/trends", permKey: "dashboard" },
  { path: "/funnel", permKey: "funnel" },
  { path: "/customers", permKey: "customer_analysis" },
  { path: "/customer-management", permKey: "customer_mgmt" },
  { path: "/order-management", permKey: "order_mgmt" },
  { path: "/ai-chat", permKey: "ai_chat" },
  { path: "/sync", permKey: "data_sync" },
  { path: "/user-management", adminOnly: true },
  { path: "/audit-log", adminOnly: true },
];

export const FALLBACK_ROUTE = "/account/settings";

export type RouteAccess = {
  isAdmin: boolean;
  hasPermission: (key: PermissionKey) => boolean;
};

export function canAccessNavItem(item: NavItemConfig, access: RouteAccess): boolean {
  if (item.adminOnly && !access.isAdmin) return false;
  if (item.permKey && !access.hasPermission(item.permKey)) return false;
  return true;
}

/** First sidebar route the user may access; falls back to account settings. */
export function getDefaultRoute(access: RouteAccess): string {
  for (const item of NAV_ITEMS) {
    if (canAccessNavItem(item, access)) return item.path;
  }
  return FALLBACK_ROUTE;
}

export function isRouteAccessible(pathname: string, access: RouteAccess): boolean {
  if (pathname === FALLBACK_ROUTE) return true;

  if (/^\/customer(-detail)?\/\d+/.test(pathname)) {
    return (
      access.isAdmin ||
      access.hasPermission("customer_mgmt") ||
      access.hasPermission("customer_analysis")
    );
  }

  if (/^\/order-detail\/\d+/.test(pathname)) {
    return access.isAdmin || access.hasPermission("order_mgmt");
  }

  const item = NAV_ITEMS.find((nav) => nav.path === pathname);
  if (!item) return true;

  return canAccessNavItem(item, access);
}
