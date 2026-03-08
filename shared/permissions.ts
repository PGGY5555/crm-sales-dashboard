/**
 * Permission definitions for the CRM system.
 * Used by both frontend (UI rendering) and backend (access control).
 */

/** All permission keys in the system */
export const PERMISSION_KEYS = [
  // Main pages
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
  "data_sync",
  // Excel import sub-permissions
  "excel_import_customers",
  "excel_import_orders",
  "excel_import_products",
  "excel_import_logistics",
  "excel_clear_data",
  // API sync sub-permissions
  "api_credentials",
  "api_sync_execute",
  "api_sync_status",
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

/** Permission group structure for UI display */
export interface PermissionGroup {
  key: string;
  label: string;
  children: { key: PermissionKey; label: string }[];
}

/** Permission groups for the checkbox UI */
export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    key: "dashboard_group",
    label: "儀表板總覽",
    children: [
      { key: "dashboard", label: "儀表板總覽" },
    ],
  },
  {
    key: "funnel_group",
    label: "銷售漏斗",
    children: [
      { key: "funnel", label: "銷售漏斗" },
    ],
  },
  {
    key: "customer_analysis_group",
    label: "客戶分析",
    children: [
      { key: "customer_analysis", label: "客戶分析" },
    ],
  },
  {
    key: "customer_mgmt_group",
    label: "客戶資料管理",
    children: [
      { key: "customer_mgmt", label: "客戶資料管理" },
      { key: "customer_mgmt_delete", label: "勾選、刪除" },
      { key: "customer_mgmt_export", label: "匯出檔案" },
    ],
  },
  {
    key: "order_mgmt_group",
    label: "訂單資料管理",
    children: [
      { key: "order_mgmt", label: "訂單資料管理" },
      { key: "order_mgmt_delete", label: "勾選、刪除" },
      { key: "order_mgmt_export", label: "匯出檔案" },
    ],
  },
  {
    key: "ai_group",
    label: "AI 洞察",
    children: [
      { key: "ai_chat", label: "AI 洞察" },
    ],
  },
  {
    key: "sync_group",
    label: "數據同步",
    children: [
      { key: "data_sync", label: "數據同步" },
    ],
  },
  {
    key: "excel_group",
    label: "Excel 匯入",
    children: [
      { key: "excel_import_customers", label: "上傳顧客列表" },
      { key: "excel_import_orders", label: "上傳訂單列表" },
      { key: "excel_import_products", label: "上傳商品列表" },
      { key: "excel_import_logistics", label: "上傳訂單物流檔" },
      { key: "excel_clear_data", label: "清除資料" },
    ],
  },
  {
    key: "api_group",
    label: "API 同步",
    children: [
      { key: "api_credentials", label: "API 憑證管理" },
      { key: "api_sync_execute", label: "執行同步" },
      { key: "api_sync_status", label: "同步狀態" },
    ],
  },
];

/** Default permissions for new users (all false) */
export function getDefaultPermissions(): Record<PermissionKey, boolean> {
  const perms: Record<string, boolean> = {};
  for (const key of PERMISSION_KEYS) {
    perms[key] = false;
  }
  return perms as Record<PermissionKey, boolean>;
}

/** All permissions enabled (for admin) */
export function getAllPermissions(): Record<PermissionKey, boolean> {
  const perms: Record<string, boolean> = {};
  for (const key of PERMISSION_KEYS) {
    perms[key] = true;
  }
  return perms as Record<PermissionKey, boolean>;
}
