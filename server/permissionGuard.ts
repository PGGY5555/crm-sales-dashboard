import { TRPCError } from "@trpc/server";
import type { PermissionKey } from "../shared/permissions";
import { checkUserPermission } from "./db";

export type PermissionUser = {
  id: number;
  role: string;
};

export async function assertPermission(
  user: PermissionUser,
  permissionKey: PermissionKey,
  message?: string,
): Promise<void> {
  if (!(await checkUserPermission(user.id, user.role, permissionKey))) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: message ?? "您沒有此操作的權限",
    });
  }
}

export async function assertAnyPermission(
  user: PermissionUser,
  permissionKeys: PermissionKey[],
  message?: string,
): Promise<void> {
  for (const key of permissionKeys) {
    if (await checkUserPermission(user.id, user.role, key)) {
      return;
    }
  }
  throw new TRPCError({
    code: "FORBIDDEN",
    message: message ?? "您沒有此操作的權限",
  });
}
