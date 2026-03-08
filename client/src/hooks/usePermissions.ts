import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import type { PermissionKey } from "@shared/permissions";

/**
 * Hook to check current user's permissions.
 * Admin users always have all permissions.
 */
export function usePermissions() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const permsQuery = trpc.userMgmt.myPermissions.useQuery(undefined, {
    enabled: !!user,
    staleTime: 60_000, // Cache for 1 minute
  });

  const permissions = permsQuery.data as Record<string, boolean> | undefined;

  /** Check if user has a specific permission */
  const hasPermission = (key: PermissionKey): boolean => {
    if (isAdmin) return true;
    if (!permissions) return false;
    return permissions[key] === true;
  };

  /** Check if user has any of the given permissions */
  const hasAnyPermission = (...keys: PermissionKey[]): boolean => {
    return keys.some((k) => hasPermission(k));
  };

  return {
    isAdmin,
    permissions,
    isLoading: permsQuery.isLoading,
    hasPermission,
    hasAnyPermission,
  };
}
