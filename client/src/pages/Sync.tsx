import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useState, useRef } from "react";
import {
  RefreshCw, CheckCircle, XCircle, Clock, AlertTriangle, Shield, Key, Save,
  Upload, FileSpreadsheet, Users, ShoppingCart, Package, Trash2, Truck
} from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";

type ExcelFileType = "customers" | "orders" | "products" | "logistics";

interface UploadState {
  file: File | null;
  uploading: boolean;
  result: any | null;
}

export default function Sync() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [apiToken, setApiToken] = useState("");
  const [appName, setAppName] = useState("");

  // Excel upload states
  const [customerUpload, setCustomerUpload] = useState<UploadState>({ file: null, uploading: false, result: null });
  const [orderUpload, setOrderUpload] = useState<UploadState>({ file: null, uploading: false, result: null });
  const [productUpload, setProductUpload] = useState<UploadState>({ file: null, uploading: false, result: null });
  const [logisticsUpload, setLogisticsUpload] = useState<UploadState>({ file: null, uploading: false, result: null });

  const customerFileRef = useRef<HTMLInputElement>(null);
  const orderFileRef = useRef<HTMLInputElement>(null);
  const productFileRef = useRef<HTMLInputElement>(null);
  const logisticsFileRef = useRef<HTMLInputElement>(null);

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

  // Clear data states
  const [clearTargets, setClearTargets] = useState<Set<string>>(new Set(["all"]));
  const utils = trpc.useUtils();

  const clearMutation = trpc.sync.clearData.useMutation({
    onSuccess: (result) => {
      const entries = Object.entries(result.deleted)
        .filter(([, v]) => v > 0)
        .map(([k, v]) => {
          const labels: Record<string, string> = { customers: "客戶", orders: "訂單", orderItems: "訂單明細", products: "商品" };
          return `${labels[k] || k} ${v} 筆`;
        });
      toast.success(`清除完成！${entries.join("、") || "無資料需清除"}`);
      // Invalidate all dashboard queries
      utils.dashboard.invalidate();
      refetchStatus();
    },
    onError: (error) => {
      toast.error(`清除失敗: ${error.message}`);
    },
  });

  const handleClearData = () => {
    const targets = Array.from(clearTargets) as ("customers" | "orders" | "products" | "all")[];
    clearMutation.mutate({ targets });
  };

  const toggleClearTarget = (target: string) => {
    setClearTargets(prev => {
      const next = new Set(prev);
      if (target === "all") {
        if (next.has("all")) {
          next.clear();
        } else {
          next.clear();
          next.add("all");
        }
      } else {
        next.delete("all");
        if (next.has(target)) {
          next.delete(target);
        } else {
          next.add(target);
        }
        // If all three selected, switch to "all"
        if (next.has("customers") && next.has("orders") && next.has("products")) {
          next.clear();
          next.add("all");
        }
      }
      return next;
    });
  };

  // Excel upload handler
  const handleExcelUpload = async (fileType: ExcelFileType) => {
    const stateMap = {
      customers: { state: customerUpload, setState: setCustomerUpload },
      orders: { state: orderUpload, setState: setOrderUpload },
      products: { state: productUpload, setState: setProductUpload },
      logistics: { state: logisticsUpload, setState: setLogisticsUpload },
    };
    const { state, setState } = stateMap[fileType];

    if (!state.file) {
      toast.error("請先選擇檔案");
      return;
    }

    setState({ ...state, uploading: true, result: null });

    try {
      const formData = new FormData();
      formData.append("file", state.file);
      formData.append("type", fileType);

      const response = await fetch("/api/upload/excel", {
        method: "POST",
        body: formData,
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "上傳失敗");
      }

      setState({ ...state, uploading: false, result });

      if (result.success || result.matched !== undefined) {
        if (fileType === "logistics") {
          toast.success(`物流資料匯入完成！匹配 ${result.matched ?? 0} 筆，未匹配 ${result.unmatched ?? 0} 筆`);
        } else {
          const typeLabel = { customers: "顧客", orders: "訂單", products: "商品", logistics: "物流" }[fileType];
          const count = result.processed ?? result.ordersProcessed ?? 0;
          toast.success(`${typeLabel}資料匯入成功！處理 ${count} 筆記錄`);
        }
        refetchStatus();
      } else {
        toast.error(`匯入失敗: ${result.error}`);
      }
    } catch (error: any) {
      setState({ ...state, uploading: false, result: { success: false, error: error.message } });
      toast.error(`匯入錯誤: ${error.message}`);
    }
  };

  const handleFileSelect = (fileType: ExcelFileType, file: File | null) => {
    const stateMap = {
      customers: setCustomerUpload,
      orders: setOrderUpload,
      products: setProductUpload,
      logistics: setLogisticsUpload,
    };
    stateMap[fileType]({ file, uploading: false, result: null });
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
      case "success": return "同步成功";
      case "failed": return "同步失敗";
      case "running": return "同步中...";
      default: return "尚未同步";
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

  // Render an Excel upload card
  const renderUploadCard = (
    fileType: ExcelFileType,
    icon: React.ReactNode,
    title: string,
    description: string,
    state: UploadState,
    fileRef: React.RefObject<HTMLInputElement | null>,
  ) => (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          {icon}
          <CardTitle className="text-base">{title}</CardTitle>
        </div>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => handleFileSelect(fileType, e.target.files?.[0] || null)}
          />
          <div
            onClick={() => fileRef.current?.click()}
            className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-colors"
          >
            {state.file ? (
              <div className="flex items-center justify-center gap-2">
                <FileSpreadsheet className="h-5 w-5 text-green-600" />
                <span className="text-sm font-medium">{state.file.name}</span>
                <span className="text-xs text-muted-foreground">
                  ({(state.file.size / 1024).toFixed(1)} KB)
                </span>
              </div>
            ) : (
              <div>
                <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground">
                  點擊選擇或拖放 Excel 檔案
                </p>
                <p className="text-xs text-muted-foreground/60 mt-1">
                  支援 .xlsx, .xls, .csv 格式
                </p>
              </div>
            )}
          </div>
        </div>

        <Button
          onClick={() => handleExcelUpload(fileType)}
          disabled={!state.file || state.uploading}
          className="w-full"
        >
          {state.uploading ? (
            <>
              <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              匯入中...
            </>
          ) : (
            <>
              <Upload className="h-4 w-4 mr-2" />
              開始匯入
            </>
          )}
        </Button>

        {state.result && (
          <div className={`p-3 rounded-lg text-sm ${
            state.result.success
              ? "bg-green-50 border border-green-200 text-green-800 dark:bg-green-950/30 dark:border-green-800 dark:text-green-300"
              : "bg-red-50 border border-red-200 text-red-800 dark:bg-red-950/30 dark:border-red-800 dark:text-red-300"
          }`}>
            {state.result.success ? (
              <div className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 shrink-0" />
                <div>
                  <p className="font-medium">匯入成功</p>
                  {state.result.processed !== undefined && (
                    <p className="text-xs mt-0.5">處理 {state.result.processed} 筆記錄</p>
                  )}
                  {state.result.ordersProcessed !== undefined && (
                    <p className="text-xs mt-0.5">
                      訂單 {state.result.ordersProcessed} 筆，商品明細 {state.result.itemsProcessed ?? 0} 筆
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <XCircle className="h-4 w-4 shrink-0" />
                <div>
                  <p className="font-medium">匯入失敗</p>
                  <p className="text-xs mt-0.5">{state.result.error}</p>
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">數據同步</h1>
        <p className="text-muted-foreground mt-1">
          管理 CRM API 憑證、同步數據或從 Excel 匯入（僅管理員）
        </p>
      </div>

      <Tabs defaultValue="excel" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="excel" className="flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4" />
            Excel 匯入
          </TabsTrigger>
          <TabsTrigger value="api" className="flex items-center gap-2">
            <Key className="h-4 w-4" />
            API 同步
          </TabsTrigger>
        </TabsList>

        {/* Excel Import Tab */}
        <TabsContent value="excel" className="space-y-6 mt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {renderUploadCard(
              "customers",
              <Users className="h-5 w-5 text-blue-600" />,
              "顧客列表",
              "匯入顧客基本資料（姓名、信箱、電話等）",
              customerUpload,
              customerFileRef,
            )}
            {renderUploadCard(
              "orders",
              <ShoppingCart className="h-5 w-5 text-green-600" />,
              "訂單列表",
              "匯入訂單資料（訂單編號、金額、商品明細等）",
              orderUpload,
              orderFileRef,
            )}
            {renderUploadCard(
              "products",
              <Package className="h-5 w-5 text-purple-600" />,
              "商品列表",
              "匯入商品資料（名稱、SKU、價格、庫存等）",
              productUpload,
              productFileRef,
            )}
            {renderUploadCard(
              "logistics",
              <Truck className="h-5 w-5 text-orange-600" />,
              "訂單物流檔",
              "匯入物流資料（用 PayNow物流單號比對出貨單號碼，寫入配送編號和物流狀態）",
              logisticsUpload,
              logisticsFileRef,
            )}
          </div>

          {/* Clear Data Card */}
          <Card className="border-destructive/30">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Trash2 className="h-5 w-5 text-destructive" />
                <CardTitle className="text-base">清除資料</CardTitle>
              </div>
              <CardDescription>重新匯入前可先清除舊資料，避免重複</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="clear-all"
                    checked={clearTargets.has("all")}
                    onCheckedChange={() => toggleClearTarget("all")}
                  />
                  <label htmlFor="clear-all" className="text-sm font-medium cursor-pointer">
                    全部清除（客戶 + 訂單 + 商品）
                  </label>
                </div>
                <div className="flex items-center space-x-2 pl-4">
                  <Checkbox
                    id="clear-customers"
                    checked={clearTargets.has("all") || clearTargets.has("customers")}
                    onCheckedChange={() => toggleClearTarget("customers")}
                    disabled={clearTargets.has("all")}
                  />
                  <label htmlFor="clear-customers" className="text-sm cursor-pointer">
                    客戶資料
                  </label>
                </div>
                <div className="flex items-center space-x-2 pl-4">
                  <Checkbox
                    id="clear-orders"
                    checked={clearTargets.has("all") || clearTargets.has("orders")}
                    onCheckedChange={() => toggleClearTarget("orders")}
                    disabled={clearTargets.has("all")}
                  />
                  <label htmlFor="clear-orders" className="text-sm cursor-pointer">
                    訂單資料（含訂單明細）
                  </label>
                </div>
                <div className="flex items-center space-x-2 pl-4">
                  <Checkbox
                    id="clear-products"
                    checked={clearTargets.has("all") || clearTargets.has("products")}
                    onCheckedChange={() => toggleClearTarget("products")}
                    disabled={clearTargets.has("all")}
                  />
                  <label htmlFor="clear-products" className="text-sm cursor-pointer">
                    商品資料
                  </label>
                </div>
              </div>

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="destructive"
                    className="w-full"
                    disabled={clearTargets.size === 0 || clearMutation.isPending}
                  >
                    {clearMutation.isPending ? (
                      <>
                        <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                        清除中...
                      </>
                    ) : (
                      <>
                        <Trash2 className="h-4 w-4 mr-2" />
                        清除選取的資料
                      </>
                    )}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>確認清除資料？</AlertDialogTitle>
                    <AlertDialogDescription>
                      此操作將永久刪除選取的資料，無法復原。請確認已備份重要資料。
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>取消</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleClearData}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      確認清除
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">匯入說明</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="prose prose-sm max-w-none text-muted-foreground">
                <ul className="space-y-1.5 list-disc pl-4">
                  <li>請使用 Shopnex 後台匯出的 Excel 檔案格式</li>
                  <li><strong className="text-foreground">建議匯入順序</strong>：先匯入顧客列表，再匯入訂單列表，然後匯入商品列表，最後匯入訂單物流檔</li>
                  <li><strong className="text-foreground">訂單物流檔</strong>：系統會用「PayNow物流單號」比對訂單的「出貨單號碼」，匹配成功後寫入「配送編號」和「物流狀態」</li>
                  <li>匯入訂單時，系統會自動根據會員信箱關聯對應的顧客，並更新客戶統計數據（總消費、訂單數、生命週期分類等）</li>
                  <li>重複匯入同一份檔案不會產生重複資料（系統會根據唯一識別碼自動更新）</li>
                  <li>支援 <strong className="text-foreground">.xlsx</strong>、<strong className="text-foreground">.xls</strong>、<strong className="text-foreground">.csv</strong> 格式</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* API Sync Tab */}
        <TabsContent value="api" className="space-y-6 mt-6">
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

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">同步狀態</CardTitle>
                  <CardDescription>最近一次同步記錄</CardDescription>
                </CardHeader>
                <CardContent>
                  {statusLoading ? (
                    <div className="py-6 text-center text-muted-foreground">載入中...</div>
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
        </TabsContent>
      </Tabs>

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
              <li>僅<strong className="text-foreground">管理員</strong>可以查看（遮罩顯示）、修改憑證、執行同步和匯入 Excel</li>
              <li>加密金鑰衍生自伺服器端環境變數，不會暴露在前端</li>
              <li>所有流量經由 <strong className="text-foreground">Cloudflare WAF</strong> 防護</li>
              <li>Excel 匯入的檔案僅在記憶體中處理，不會存留在伺服器上</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
