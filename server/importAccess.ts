import { eq } from "drizzle-orm";
import type { PermissionKey } from "../shared/permissions";
import { importJobs, type ImportJob } from "../drizzle/schema";
import { getDb, checkUserPermission } from "./db";

export const IMPORT_FILE_TYPE_PERMISSIONS: Record<string, PermissionKey> = {
  customers: "excel_import_customers",
  orders: "excel_import_orders",
  products: "excel_import_products",
  logistics: "excel_import_logistics",
};

export function getImportPermissionForFileType(fileType: string): PermissionKey | undefined {
  return IMPORT_FILE_TYPE_PERMISSIONS[fileType];
}

export async function verifyImportFileTypePermission(
  userId: number,
  userRole: string,
  fileType: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const permission = getImportPermissionForFileType(fileType);
  if (!permission) {
    return { ok: false, status: 400, error: "不支援的檔案類型" };
  }
  if (!(await checkUserPermission(userId, userRole, permission))) {
    return { ok: false, status: 403, error: "您沒有執行此匯入操作的權限" };
  }
  return { ok: true };
}

export function canAccessImportJob(job: Pick<ImportJob, "userId">, userId: number, userRole: string): boolean {
  return userRole === "admin" || job.userId === userId;
}

export async function verifyImportJobAccess(
  jobId: number,
  userId: number,
  userRole: string,
  expectedFileType?: string,
): Promise<
  | { ok: true; job: ImportJob }
  | { ok: false; status: number; error: string }
> {
  const db = await getDb();
  if (!db) {
    return { ok: false, status: 500, error: "資料庫不可用" };
  }

  const [job] = await db.select().from(importJobs).where(eq(importJobs.id, jobId));
  if (!job) {
    return { ok: false, status: 404, error: "任務不存在" };
  }

  if (!canAccessImportJob(job, userId, userRole)) {
    return { ok: false, status: 403, error: "您沒有權限操作此匯入任務" };
  }

  const permCheck = await verifyImportFileTypePermission(userId, userRole, job.fileType);
  if (!permCheck.ok) {
    return permCheck;
  }

  if (expectedFileType && expectedFileType !== job.fileType) {
    return { ok: false, status: 400, error: "任務類型與請求不符" };
  }

  return { ok: true, job };
}
