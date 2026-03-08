import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Users, Shield, Trash2, Settings, Loader2 } from "lucide-react";
import { PERMISSION_GROUPS, type PermissionKey } from "@shared/permissions";

export default function UserManagement() {
  const { user: currentUser } = useAuth();
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [showPermDialog, setShowPermDialog] = useState(false);
  const [showRemoveDialog, setShowRemoveDialog] = useState(false);
  const [removeTargetId, setRemoveTargetId] = useState<number | null>(null);
  const [removeTargetName, setRemoveTargetName] = useState("");

  const usersQuery = trpc.userMgmt.list.useQuery();
  const removeMutation = trpc.userMgmt.remove.useMutation({
    onSuccess: () => {
      toast.success("使用者已移除");
      usersQuery.refetch();
      setShowRemoveDialog(false);
    },
    onError: (err) => toast.error(err.message),
  });
  const updateRoleMutation = trpc.userMgmt.updateRole.useMutation({
    onSuccess: () => {
      toast.success("角色已更新");
      usersQuery.refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const handleRemove = (userId: number, userName: string) => {
    setRemoveTargetId(userId);
    setRemoveTargetName(userName || "此使用者");
    setShowRemoveDialog(true);
  };

  const confirmRemove = () => {
    if (removeTargetId) {
      removeMutation.mutate({ userId: removeTargetId });
    }
  };

  const handleRoleChange = (userId: number, role: "user" | "admin") => {
    updateRoleMutation.mutate({ userId, role });
  };

  const openPermissions = (userId: number) => {
    setSelectedUserId(userId);
    setShowPermDialog(true);
  };

  if (currentUser?.role !== "admin") {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <p className="text-muted-foreground">僅管理員可存取此頁面</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">使用者管理</h1>
        <p className="text-muted-foreground mt-1">管理系統使用者帳號與權限設定</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            使用者列表
          </CardTitle>
        </CardHeader>
        <CardContent>
          {usersQuery.isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[50px]">#</TableHead>
                    <TableHead>名稱</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>登入方式</TableHead>
                    <TableHead>角色</TableHead>
                    <TableHead>最後登入</TableHead>
                    <TableHead>建立時間</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {usersQuery.data?.map((u, idx) => {
                    const isCurrentUser = u.id === currentUser?.id;
                    const isOwner = u.openId === import.meta.env.VITE_OWNER_OPEN_ID;
                    return (
                      <TableRow key={u.id}>
                        <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
                        <TableCell className="font-medium">
                          {u.name || "-"}
                          {isCurrentUser && (
                            <Badge variant="outline" className="ml-2 text-xs">你</Badge>
                          )}
                        </TableCell>
                        <TableCell>{u.email || "-"}</TableCell>
                        <TableCell>{u.loginMethod || "-"}</TableCell>
                        <TableCell>
                          {isCurrentUser || isOwner ? (
                            <Badge variant={u.role === "admin" ? "default" : "secondary"}>
                              {u.role === "admin" ? "管理員" : "使用者"}
                            </Badge>
                          ) : (
                            <Select
                              value={u.role}
                              onValueChange={(val) => handleRoleChange(u.id, val as "user" | "admin")}
                            >
                              <SelectTrigger className="w-[100px] h-8">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="admin">管理員</SelectItem>
                                <SelectItem value="user">使用者</SelectItem>
                              </SelectContent>
                            </Select>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {u.lastSignedIn ? new Date(u.lastSignedIn).toLocaleString("zh-TW") : "-"}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {u.createdAt ? new Date(u.createdAt).toLocaleString("zh-TW") : "-"}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            {u.role !== "admin" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => openPermissions(u.id)}
                                title="權限設定"
                              >
                                <Shield className="h-4 w-4" />
                              </Button>
                            )}
                            {!isCurrentUser && !isOwner && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-destructive hover:text-destructive"
                                onClick={() => handleRemove(u.id, u.name || "")}
                                title="移除使用者"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {(!usersQuery.data || usersQuery.data.length === 0) && (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                        尚無使用者資料
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-sm text-muted-foreground">
        使用者透過 Manus OAuth 登入後會自動出現在列表中。管理員擁有所有權限，不需另外設定。
        一般使用者需要透過「權限設定」來開放各功能的存取權限。
      </p>

      {/* Permission Dialog */}
      {showPermDialog && selectedUserId && (
        <PermissionDialog
          userId={selectedUserId}
          userName={usersQuery.data?.find(u => u.id === selectedUserId)?.name || ""}
          open={showPermDialog}
          onClose={() => setShowPermDialog(false)}
        />
      )}

      {/* Remove Confirmation */}
      <AlertDialog open={showRemoveDialog} onOpenChange={setShowRemoveDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>確認移除使用者</AlertDialogTitle>
            <AlertDialogDescription>
              確定要移除「{removeTargetName}」嗎？此操作無法復原，該使用者的權限設定也會一併刪除。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmRemove}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {removeMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Trash2 className="h-4 w-4 mr-2" />
              )}
              移除此員工
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Permission editing dialog with checkbox grid */
function PermissionDialog({
  userId,
  userName,
  open,
  onClose,
}: {
  userId: number;
  userName: string;
  open: boolean;
  onClose: () => void;
}) {
  const permsQuery = trpc.userMgmt.getPermissions.useQuery({ userId }, { enabled: open });
  const [localPerms, setLocalPerms] = useState<Record<string, boolean> | null>(null);
  const saveMutation = trpc.userMgmt.savePermissions.useMutation({
    onSuccess: () => {
      toast.success("權限已儲存");
      onClose();
    },
    onError: (err) => toast.error(err.message),
  });

  // Sync from query to local state
  const perms: Record<string, boolean> = localPerms ?? permsQuery.data ?? {};

  const togglePerm = (key: string, checked: boolean) => {
    setLocalPerms((prev) => ({ ...(prev ?? permsQuery.data ?? {}), [key]: checked }));
  };

  const toggleGroup = (group: typeof PERMISSION_GROUPS[number], checked: boolean) => {
    setLocalPerms((prev) => {
      const next = { ...(prev ?? permsQuery.data ?? {}) };
      for (const child of group.children) {
        next[child.key] = checked;
      }
      return next;
    });
  };

  const isGroupChecked = (group: typeof PERMISSION_GROUPS[number]) => {
    return group.children.every((c) => perms[c.key] === true);
  };

  const isGroupIndeterminate = (group: typeof PERMISSION_GROUPS[number]) => {
    const checked = group.children.filter((c) => perms[c.key] === true).length;
    return checked > 0 && checked < group.children.length;
  };

  const handleSave = () => {
    saveMutation.mutate({ userId, permissions: perms });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            權限設定 - {userName || `使用者 #${userId}`}
          </DialogTitle>
          <DialogDescription>
            勾選該使用者可存取的功能模組。管理員自動擁有所有權限。
          </DialogDescription>
        </DialogHeader>

        {permsQuery.isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 py-4">
            {PERMISSION_GROUPS.map((group) => (
              <div key={group.key} className="space-y-3">
                {/* Group header checkbox */}
                <div className="flex items-center gap-2">
                  <Checkbox
                    id={`group-${group.key}`}
                    checked={isGroupChecked(group)}
                    ref={(el) => {
                      if (el) {
                        (el as any).indeterminate = isGroupIndeterminate(group);
                      }
                    }}
                    onCheckedChange={(checked) => toggleGroup(group, !!checked)}
                  />
                  <label
                    htmlFor={`group-${group.key}`}
                    className="text-sm font-semibold cursor-pointer select-none"
                  >
                    {group.label}
                  </label>
                </div>
                {/* Children checkboxes */}
                <div className="ml-6 space-y-2">
                  {group.children.map((child) => (
                    <div key={child.key} className="flex items-center gap-2">
                      <Checkbox
                        id={`perm-${child.key}`}
                        checked={perms[child.key] === true}
                        onCheckedChange={(checked) => togglePerm(child.key, !!checked)}
                      />
                      <label
                        htmlFor={`perm-${child.key}`}
                        className="text-sm cursor-pointer select-none"
                      >
                        {child.label}
                      </label>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        <DialogFooter className="flex items-center justify-between sm:justify-between">
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button onClick={handleSave} disabled={saveMutation.isPending}>
              {saveMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              儲存
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
