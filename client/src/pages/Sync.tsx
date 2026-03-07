import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useState } from "react";
import { RefreshCw, CheckCircle, XCircle, Clock, AlertTriangle, Shield, Key, Save } from "lucide-react";
import { toast } from "sonner";

export default function Sync() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [apiToken, setApiToken] = useState("");
  const [appName, setAppName] = useState("");

  const { data: credentials, isLoading: credsLoading, refetch: refetchCreds } =
    trpc.settings.getCredentials.useQuery(undefined, { enabled: isAdmin });

  const { data: syncStatus, isLoading: statusLoading, refetch: refetchStatus } =
    trpc.dashboard.syncStatus.useQuery();

  const saveMutation = trpc.settings.saveCredentials.useMutation({
    onSuccess: () => {
      toast.success("API 憑證已加密儲存");
      setApiToken("");
      setAppName("");
      refetchCreds();
    },
    onError: (error) => {
      toast.error(`儲存失敗: ${error.message}`);
    },
  });

  const syncMutation = trpc.sync.trigger.useMutation({
    onSuccess: (result) => {
      if (result.success) {
        toast.success(
          `同步完成！客戶: ${(result as any).customersProcessed ?? 0} 筆, 訂單: ${(result as any).ordersProcessed ?? 0} 筆`
        );
      } else {
        toast.error(`同步失敗: ${result.error}`);
      }
      refetchStatus();
    },
    onError: (error) => {
      toast.error(`同步錯誤: ${error.message}`);
    },
  });

  const handleSave = () => {
    if (!apiToken.trim() || !appName.trim()) {
      toast.error("請填寫 API Token 和 App Name");
      return;
    }
    saveMutation.mutate({ apiToken: apiToken.trim(), appName: appName.trim() });
  };

  const handleSync = () => {
    syncMutation.mutate();
  };

  const getStatusIcon = (status: string | undefined) => {
    switch (status) {
      case "success":
        return <CheckCircle className="h-5 w-5 text-green-500" />;
      case "failed":
        return <XCircle className="h-5 w-5 text-red-500" />;
      case "running":
        return <RefreshCw className="h-5 w-5 text-blue-500 animate-spin" />;
      default:
        return <Clock className="h-5 w-5 text-muted-foreground" />;
    }
  };

  const getStatusText = (status: string | undefined) => {
    switch (status) {
      case "success":
        return "同步成功";
      case "failed":
        return "同步失敗";
      case "running":
        return "同步中...";
      default:
        return "尚未同步";
    }
  };

  if (!isAdmin) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">數據同步</h1>
          <p className="text-muted-foreground mt-1">
            從 Shopnex CRM 同步客戶與訂單數據
          </p>
        </div>
        <Card>
          <CardContent className="py-12 text-center">
            <Shield className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-40" />
            <p className="text-lg font-medium">權限不足</p>
            <p className="text-muted-foreground mt-2">
              僅管理員可以管理 API 憑證和執行數據同步。
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">數據同步</h1>
        <p className="text-muted-foreground mt-1">
          管理 CRM API 憑證與同步數據（僅管理員）
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Credential Management */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Key className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">API 憑證管理</CardTitle>
            </div>
            <CardDescription>
              API 憑證將以 AES-256 加密後儲存於資料庫中
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Current status */}
            {credsLoading ? (
              <div className="p-3 rounded-lg bg-muted/50 text-sm text-muted-foreground">
                載入中...
              </div>
            ) : (
              <div className="space-y-3">
                <div className="p-3 rounded-lg bg-muted/50">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">API Token</span>
                    {credentials?.apiToken.exists ? (
                      <span className="text-sm font-mono text-green-600">
                        {credentials.apiToken.masked}
                      </span>
                    ) : (
                      <span className="text-sm text-orange-500">尚未設定</span>
                    )}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-muted/50">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">App Name</span>
                    {credentials?.appName.exists ? (
                      <span className="text-sm font-mono text-green-600">
                        {credentials.appName.masked}
                      </span>
                    ) : (
                      <span className="text-sm text-orange-500">尚未設定</span>
                    )}
                  </div>
                </div>
                {credentials?.apiToken.updatedAt && (
                  <p className="text-xs text-muted-foreground">
                    最後更新：{new Date(credentials.apiToken.updatedAt).toLocaleString("zh-TW")}
                  </p>
                )}
              </div>
            )}

            <div className="border-t pt-4 space-y-3">
              <p className="text-sm font-medium">更新憑證</p>
              <div className="space-y-2">
                <Label htmlFor="apiToken">API Token</Label>
                <Input
                  id="apiToken"
                  type="password"
                  placeholder="輸入新的 Shopnex API Token"
                  value={apiToken}
                  onChange={(e) => setApiToken(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="appName">App Name (g-app)</Label>
                <Input
                  id="appName"
                  placeholder="輸入 App Name"
                  value={appName}
                  onChange={(e) => setAppName(e.target.value)}
                />
              </div>
              <Button
                onClick={handleSave}
                disabled={saveMutation.isPending || !apiToken.trim() || !appName.trim()}
                className="w-full"
                variant="outline"
              >
                {saveMutation.isPending ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    加密儲存中...
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4 mr-2" />
                    加密儲存憑證
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Sync Control & Status */}
        <div className="space-y-6">
          {/* Sync Button */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">執行同步</CardTitle>
              <CardDescription>
                使用已儲存的 API 憑證從 Shopnex 拉取最新數據
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                onClick={handleSync}
                disabled={
                  syncMutation.isPending ||
                  (!credentials?.apiToken.exists || !credentials?.appName.exists)
                }
                className="w-full"
                size="lg"
              >
                {syncMutation.isPending ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    同步中...
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    開始同步
                  </>
                )}
              </Button>
              {(!credentials?.apiToken.exists || !credentials?.appName.exists) && (
                <p className="text-xs text-orange-500 mt-2 text-center">
                  請先在左側儲存 API 憑證後才能同步
                </p>
              )}
            </CardContent>
          </Card>

          {/* Sync Status */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">同步狀態</CardTitle>
              <CardDescription>最近一次同步記錄</CardDescription>
            </CardHeader>
            <CardContent>
              {statusLoading ? (
                <div className="py-6 text-center text-muted-foreground">
                  載入中...
                </div>
              ) : syncStatus ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                    {getStatusIcon(syncStatus.status)}
                    <div>
                      <p className="font-medium">{getStatusText(syncStatus.status)}</p>
                      <p className="text-sm text-muted-foreground">
                        類型: {syncStatus.syncType}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 rounded-lg border">
                      <p className="text-xs text-muted-foreground">處理記錄數</p>
                      <p className="text-lg font-bold mt-1">
                        {syncStatus.recordsProcessed ?? 0}
                      </p>
                    </div>
                    <div className="p-3 rounded-lg border">
                      <p className="text-xs text-muted-foreground">完成時間</p>
                      <p className="text-sm font-medium mt-1">
                        {syncStatus.completedAt
                          ? new Date(syncStatus.completedAt).toLocaleString("zh-TW")
                          : "—"}
                      </p>
                    </div>
                  </div>

                  {syncStatus.errorMessage && (
                    <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                      <div className="flex items-center gap-2 mb-1">
                        <AlertTriangle className="h-4 w-4 text-destructive" />
                        <p className="text-sm font-medium text-destructive">錯誤訊息</p>
                      </div>
                      <p className="text-sm text-destructive/80">
                        {syncStatus.errorMessage}
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="py-6 text-center text-muted-foreground">
                  <Clock className="h-10 w-10 mx-auto mb-2 opacity-20" />
                  <p>尚未進行過數據同步</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Security Info */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-green-600" />
            <CardTitle className="text-base">安全說明</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="prose prose-sm max-w-none text-muted-foreground">
            <ul className="space-y-1.5 list-disc pl-4">
              <li>API 憑證使用 <strong className="text-foreground">AES-256-CBC</strong> 加密後儲存於資料庫</li>
              <li>僅<strong className="text-foreground">管理員</strong>可以查看（遮罩顯示）、修改憑證和執行同步</li>
              <li>加密金鑰衍生自伺服器端環境變數，不會暴露在前端</li>
              <li>所有流量經由 <strong className="text-foreground">Cloudflare WAF</strong> 防護</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
