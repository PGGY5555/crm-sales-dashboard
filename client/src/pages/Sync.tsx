import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useState } from "react";
import { RefreshCw, CheckCircle, XCircle, Clock, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

export default function Sync() {
  const [apiToken, setApiToken] = useState("");
  const [appName, setAppName] = useState("");

  const { data: syncStatus, isLoading: statusLoading, refetch } =
    trpc.dashboard.syncStatus.useQuery();

  const syncMutation = trpc.sync.trigger.useMutation({
    onSuccess: (result) => {
      if (result.success) {
        toast.success(
          `同步完成！客戶: ${result.customersProcessed} 筆, 訂單: ${result.ordersProcessed} 筆`
        );
      } else {
        toast.error(`同步失敗: ${result.error}`);
      }
      refetch();
    },
    onError: (error) => {
      toast.error(`同步錯誤: ${error.message}`);
    },
  });

  const handleSync = () => {
    if (!apiToken.trim() || !appName.trim()) {
      toast.error("請填寫 API Token 和 App Name");
      return;
    }
    syncMutation.mutate({ apiToken: apiToken.trim(), appName: appName.trim() });
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">數據同步</h1>
        <p className="text-muted-foreground mt-1">
          從 Shopnex CRM 同步客戶與訂單數據
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Sync Configuration */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">API 設定</CardTitle>
            <CardDescription>
              輸入 Shopnex API 憑證以同步 CRM 數據
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="apiToken">API Token</Label>
              <Input
                id="apiToken"
                type="password"
                placeholder="輸入 Shopnex API Token"
                value={apiToken}
                onChange={(e) => setApiToken(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                從 Shopnex 後台取得開發金鑰
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="appName">App Name (g-app)</Label>
              <Input
                id="appName"
                placeholder="輸入 App Name"
                value={appName}
                onChange={(e) => setAppName(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                透過 Shopnex 後台網址列取得 appName
              </p>
            </div>
            <Button
              onClick={handleSync}
              disabled={syncMutation.isPending || !apiToken.trim() || !appName.trim()}
              className="w-full"
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
              <div className="py-8 text-center text-muted-foreground">
                載入中...
              </div>
            ) : syncStatus ? (
              <div className="space-y-4">
                <div className="flex items-center gap-3 p-4 rounded-lg bg-muted/50">
                  {getStatusIcon(syncStatus.status)}
                  <div>
                    <p className="font-medium">{getStatusText(syncStatus.status)}</p>
                    <p className="text-sm text-muted-foreground">
                      類型: {syncStatus.syncType}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="p-3 rounded-lg border">
                    <p className="text-xs text-muted-foreground">處理記錄數</p>
                    <p className="text-lg font-bold mt-1">
                      {syncStatus.recordsProcessed ?? 0}
                    </p>
                  </div>
                  <div className="p-3 rounded-lg border">
                    <p className="text-xs text-muted-foreground">開始時間</p>
                    <p className="text-sm font-medium mt-1">
                      {syncStatus.startedAt
                        ? new Date(syncStatus.startedAt).toLocaleString("zh-TW")
                        : "—"}
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
              <div className="py-8 text-center text-muted-foreground">
                <Clock className="h-12 w-12 mx-auto mb-3 opacity-20" />
                <p>尚未進行過數據同步</p>
                <p className="text-sm mt-1">
                  請在左側填寫 API 憑證後開始同步
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Instructions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">使用說明</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="prose prose-sm max-w-none text-muted-foreground">
            <ol className="space-y-2">
              <li>
                <strong className="text-foreground">取得 API Token：</strong>
                登入 Shopnex 後台，在開發者設定中取得 API 金鑰。
              </li>
              <li>
                <strong className="text-foreground">取得 App Name：</strong>
                從 Shopnex 後台網址列中取得您的 appName（g-app 值）。
              </li>
              <li>
                <strong className="text-foreground">開始同步：</strong>
                填入上述資訊後點擊「開始同步」，系統將自動拉取客戶與訂單數據。
              </li>
              <li>
                <strong className="text-foreground">自動分類：</strong>
                同步完成後，系統會自動根據出貨記錄和購買頻率計算客戶生命週期分類（NASLDO）。
              </li>
            </ol>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
