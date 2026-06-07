import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useState, useRef, useEffect, useCallback } from "react";
import {
  RefreshCw, CheckCircle, XCircle, Clock, AlertTriangle, Shield, Key, Save,
  Upload, FileSpreadsheet, Users, ShoppingCart, Package, Trash2, Truck, Loader2
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
import { usePermissions } from "@/hooks/usePermissions";
import { Progress } from "@/components/ui/progress";
import { parseExcelFile } from "@/lib/excelUtils";
import { getOrderNumberFromRow, normalizeOrderImportRow } from "@shared/importFieldMapping";
import { mergeImportStatsHints, type ImportStatsHints } from "@shared/importStats";

type ExcelFileType = "customers" | "orders" | "products" | "logistics";

interface UploadState {
  file: File | null;
  uploading: boolean;
  result: any | null;
  /** Background job tracking */
  jobId: number | null;
  jobStatus: string | null; // "pending" | "processing" | "completed" | "failed"
  jobProgress: number; // 0-100
  jobDetail: string | null;
}

const defaultUploadState: UploadState = {
  file: null,
  uploading: false,
  result: null,
  jobId: null,
  jobStatus: null,
  jobProgress: 0,
  jobDetail: null,
};

export default function Sync() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const { hasPermission } = usePermissions();
  const canUploadCustomers = hasPermission("excel_import_customers");
  const canUploadOrders = hasPermission("excel_import_orders");
  const canUploadProducts = hasPermission("excel_import_products");
  const canUploadLogistics = hasPermission("excel_import_logistics");
  const canClearData = hasPermission("excel_clear_data");
  const canApiCredentials = hasPermission("api_credentials");
  const canApiExecute = hasPermission("api_sync_execute");
  const canApiStatus = hasPermission("api_sync_status");

  const [apiToken, setApiToken] = useState("");
  const [appName, setAppName] = useState("");

  // Excel upload states
  const [customerUpload, setCustomerUpload] = useState<UploadState>({ ...defaultUploadState });
  const [orderUpload, setOrderUpload] = useState<UploadState>({ ...defaultUploadState });
  const [productUpload, setProductUpload] = useState<UploadState>({ ...defaultUploadState });
  const [logisticsUpload, setLogisticsUpload] = useState<UploadState>({ ...defaultUploadState });

  const customerFileRef = useRef<HTMLInputElement>(null);
  const orderFileRef = useRef<HTMLInputElement>(null);
  const productFileRef = useRef<HTMLInputElement>(null);
  const logisticsFileRef = useRef<HTMLInputElement>(null);

  const fileRefByType: Record<ExcelFileType, React.RefObject<HTMLInputElement | null>> = {
    customers: customerFileRef,
    orders: orderFileRef,
    products: productFileRef,
    logistics: logisticsFileRef,
  };

  // Polling refs for background jobs
  const pollingRefs = useRef<Record<string, ReturnType<typeof setInterval> | null>>({
    customers: null,
    orders: null,
    products: null,
    logistics: null,
  });

  const canAccessSync = hasPermission("data_sync");

  const { data: credentials, isLoading: credsLoading, refetch: refetchCreds } =
    trpc.settings.getCredentials.useQuery(undefined, { enabled: isAdmin || canApiCredentials });

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
  const [clearTargets, setClearTargets] = useState<Set<string>>(new Set());
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
        if (next.has("customers") && next.has("orders") && next.has("products")) {
          next.clear();
          next.add("all");
        }
      }
      return next;
    });
  };

  // Helper: get state setter by file type
  const getStateSetter = useCallback((fileType: ExcelFileType) => {
    const map = {
      customers: setCustomerUpload,
      orders: setOrderUpload,
      products: setProductUpload,
      logistics: setLogisticsUpload,
    };
    return map[fileType];
  }, []);

  // Trigger server-side processing in chunks and update progress
  const startProcessing = useCallback((fileType: ExcelFileType, jobId: number) => {
    // Clear existing polling for this type
    if (pollingRefs.current[fileType]) {
      clearInterval(pollingRefs.current[fileType]!);
      pollingRefs.current[fileType] = null;
    }

    const setter = getStateSetter(fileType);
    const typeLabel = { customers: "顧客", orders: "訂單", products: "商品", logistics: "物流" }[fileType];
    let stopped = false;
    let retryCount = 0;
    const MAX_RETRIES = 10;

    // Repeatedly call /api/import/process until done
    const processNextChunk = async () => {
      if (stopped) return;
      try {
        const resp = await fetch("/api/import/process", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId }),
        });

        if (!resp.ok) {
          const errData = await resp.json().catch(() => ({ error: "處理請求失敗" }));
          throw new Error(errData.error || "處理請求失敗");
        }

        const data = await resp.json();
        console.log("[Import Chunk]", data);
        retryCount = 0; // Reset retry count on success

        const totalRows = data.totalRows || 1;
        const processedRows = data.processedRows || 0;
        const progress = Math.min(Math.round((processedRows / totalRows) * 100), 100);

        // Show different message for parsing phase vs importing phase
        const detail = data.phase === "parsing"
          ? data.message || `正在解析 Excel 檔案（${totalRows.toLocaleString()} 筆）...`
          : `已處理 ${processedRows.toLocaleString()} / ${totalRows.toLocaleString()} 筆（成功 ${(data.successRows || 0).toLocaleString()}，錯誤 ${(data.errorRows || 0).toLocaleString()}）`;

        setter(prev => ({
          ...prev,
          jobStatus: data.done ? (data.status === "failed" ? "failed" : "completed") : "processing",
          jobProgress: progress,
          jobDetail: detail,
        }));

        if (data.done || data.status === "completed" || data.status === "failed") {
          stopped = true;
          setter(prev => ({
            ...prev,
            file: data.status === "completed" ? null : prev.file,
            uploading: false,
            jobProgress: data.status === "completed" ? 100 : prev.jobProgress,
            result: data.status === "completed"
              ? { success: true, processed: data.successRows, backgroundJob: true }
              : { success: false, error: data.message || "匯入失敗" },
          }));
          if (data.status === "completed") {
            const fileInput = fileRefByType[fileType].current;
            if (fileInput) fileInput.value = "";
            toast.success(`${typeLabel}資料匯入完成！成功 ${(data.successRows || 0).toLocaleString()} 筆`);
            refetchStatus();
          } else if (data.status === "failed") {
            toast.error(`${typeLabel}資料匯入失敗: ${data.message || "未知錯誤"}`);
          }
          return;
        }

        // Continue with next chunk after a short delay
        setTimeout(processNextChunk, 500);
      } catch (err: any) {
        console.error("[Import Chunk] Error:", err);
        retryCount++;
        if (retryCount >= MAX_RETRIES) {
          stopped = true;
          setter(prev => ({
            ...prev,
            uploading: false,
            jobStatus: "failed",
            result: { success: false, error: `處理失敗（已重試 ${MAX_RETRIES} 次）: ${err.message}` },
          }));
          toast.error(`${typeLabel}資料匯入失敗：已重試 ${MAX_RETRIES} 次仍無法完成`);
          return;
        }
        setter(prev => ({
          ...prev,
          jobDetail: (prev.jobDetail || "") + ` (重試中 ${retryCount}/${MAX_RETRIES}...)`,
        }));
        setTimeout(processNextChunk, 3000);
      }
    };

    // Start processing after a short delay
    setTimeout(processNextChunk, 1000);
  }, [getStateSetter, refetchStatus, fileRefByType]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      Object.values(pollingRefs.current).forEach(interval => {
        if (interval) clearInterval(interval);
      });
    };
  }, []);

  // Excel upload handler: parse in browser, then batch-upload JSON to server
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

    setState({
      ...state,
      uploading: true,
      result: null,
      jobId: null,
      jobStatus: "processing",
      jobProgress: 0,
      jobDetail: "正在解析 Excel 檔案...",
    });

    const BATCH_SIZE = 500;
    const typeLabel = { customers: "顧客", orders: "訂單", products: "商品", logistics: "物流" }[fileType];

    try {
      // STEP 1: Parse Excel in browser
      const rawRows = await parseExcelFile(state.file) as any[];

      // For orders, group by order number
      let processedData: any[];
      if (fileType === "orders") {
        const orderMap = new Map<string, any[]>();
        for (const row of rawRows) {
          const normalized = normalizeOrderImportRow(row);
          const orderNum = getOrderNumberFromRow(normalized);
          if (!orderNum) continue;
          if (!orderMap.has(orderNum)) orderMap.set(orderNum, []);
          orderMap.get(orderNum)!.push(normalized);
        }
        processedData = Array.from(orderMap.entries()).map(([num, items]) => ({ orderNum: num, items }));
      } else {
        processedData = rawRows;
      }

      const totalRows = processedData.length;
      if (totalRows === 0) {
        throw new Error("檔案中未找到可匯入的資料列，請確認第一列為標題列且下方有資料");
      }

      toast.info(`已解析 ${totalRows.toLocaleString()} 筆${typeLabel}資料，開始匯入...`);

      setState(prev => ({
        ...prev,
        jobDetail: `已解析 ${totalRows.toLocaleString()} 筆資料，開始匯入...`,
        jobProgress: 0,
      }));

      // STEP 2: Create job on server
      const createResp = await fetch("/api/import/create-job", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileType, fileName: state.file.name, totalRows }),
      });
      if (!createResp.ok) {
        const err = await createResp.json().catch(() => ({ error: "建立任務失敗" }));
        throw new Error(err.error || "建立任務失敗");
      }
      const { jobId } = await createResp.json();

      setState(prev => ({ ...prev, jobId }));

      // STEP 3: Batch upload
      let totalSuccess = 0;
      let totalError = 0;
      let totalProcessed = 0;
      const totalBatches = Math.ceil(totalRows / BATCH_SIZE);
      let accumulatedStatsHints: ImportStatsHints = {};

      for (let offset = 0; offset < totalRows; offset += BATCH_SIZE) {
        const batch = processedData.slice(offset, offset + BATCH_SIZE);
        const batchNum = Math.floor(offset / BATCH_SIZE) + 1;

        setState(prev => ({
          ...prev,
          jobDetail: `正在寫入第 ${batchNum}/${totalBatches} 批（共 ${totalRows.toLocaleString()} 筆）...`,
        }));

        let retries = 0;
        const MAX_RETRIES = 3;
        let batchSuccess = false;

        while (retries < MAX_RETRIES && !batchSuccess) {
          try {
            const resp = await fetch("/api/import/batch", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ jobId, fileType, batch, offset, totalRows }),
            });

            if (!resp.ok) {
              const errData = await resp.json().catch(() => ({ error: "處理失敗" }));
              throw new Error(errData.error || "處理失敗");
            }

            const data = await resp.json();
            totalSuccess += data.successRows || 0;
            totalError += data.errorRows || 0;
            totalProcessed = totalSuccess + totalError;
            if (data.statsHints) {
              accumulatedStatsHints = mergeImportStatsHints(accumulatedStatsHints, data.statsHints);
            }
            batchSuccess = true;

            const progress = Math.min(Math.round((totalProcessed / totalRows) * 100), 100);
            setState(prev => ({
              ...prev,
              jobStatus: "processing",
              jobProgress: progress,
              jobDetail: `第 ${batchNum}/${totalBatches} 批—已處理 ${totalProcessed.toLocaleString()} / ${totalRows.toLocaleString()} 筆（成功 ${totalSuccess.toLocaleString()}，錯誤 ${totalError.toLocaleString()}）`,
            }));
          } catch (err: any) {
            retries++;
            if (retries >= MAX_RETRIES) {
              throw new Error(`第 ${batchNum} 批處理失敗（已重試 ${MAX_RETRIES} 次）: ${err.message}`);
            }
            setState(prev => ({
              ...prev,
              jobDetail: (prev.jobDetail || "") + ` (重試中 ${retries}/${MAX_RETRIES}...)`,
            }));
            await new Promise(r => setTimeout(r, 2000));
          }
        }
      }

      // STEP 4: Complete
      if (fileType === "orders" || fileType === "customers" || fileType === "logistics") {
        setState(prev => ({
          ...prev,
          jobDetail: "資料寫入完成，正在更新受影響客戶的統計...",
        }));
      }

      let statsWarning: string | undefined;
      let statsError: string | undefined;

      const completeResp = await fetch("/api/import/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId,
          successRows: totalSuccess,
          errorRows: totalError,
          statsHints: accumulatedStatsHints,
        }),
      });

      if (!completeResp.ok) {
        const errData = await completeResp.json().catch(() => ({ error: "完成匯入任務失敗" }));
        throw new Error(errData.error || "完成匯入任務失敗");
      }

      const completeData = await completeResp.json().catch(() => ({}));
      statsWarning = completeData.statsWarning;
      statsError = completeData.statsError;

      if (totalSuccess === 0 && totalError > 0) {
        throw new Error(
          `共 ${totalError.toLocaleString()} 筆資料無法寫入。請確認欄位標題是否正確（顧客列表需包含「顧客名稱/顧客姓名」、「電子信箱」、「電話/手機」至少一項）`,
        );
      }
      if (totalSuccess === 0) {
        throw new Error("未成功匯入任何資料，請確認檔案格式與欄位標題是否正確");
      }

      setState(prev => ({
        ...prev,
        file: null,
        uploading: false,
        jobStatus: "completed",
        jobProgress: 100,
        jobDetail: `匯入完成！成功 ${totalSuccess.toLocaleString()} 筆，錯誤 ${totalError.toLocaleString()} 筆`,
        result: { success: true, processed: totalSuccess, errorCount: totalError, backgroundJob: true },
      }));
      const fileInput = fileRefByType[fileType].current;
      if (fileInput) fileInput.value = "";
      if (statsError) {
        toast.error(`資料已匯入，但會員統計更新失敗：${statsError}`);
      } else if (statsWarning) {
        toast.warning(statsWarning);
      } else {
        toast.success(`${typeLabel}資料匯入完成！成功 ${totalSuccess.toLocaleString()} 筆`);
      }
      refetchStatus();
    } catch (error: any) {
      setState(prev => ({
        ...prev,
        uploading: false,
        jobStatus: "failed",
        result: { success: false, error: error.message },
      }));
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
    stateMap[fileType]({ ...defaultUploadState, file });
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

  if (!canAccessSync && !isAdmin) {
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
              您沒有數據同步的存取權限，請聯繫管理員開啟。
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Render an Excel upload card with background job progress support
  const renderUploadCard = (
    fileType: ExcelFileType,
    icon: React.ReactNode,
    title: string,
    description: string,
    state: UploadState,
    fileRef: React.RefObject<HTMLInputElement | null>,
  ) => {
    const isBackgroundJob = state.jobId !== null;
    const isProcessing = state.uploading || (isBackgroundJob && (state.jobStatus === "pending" || state.jobStatus === "processing"));

    return (
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
              onClick={() => !isProcessing && fileRef.current?.click()}
              className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
                isProcessing
                  ? "cursor-not-allowed opacity-60"
                  : "cursor-pointer hover:border-primary/50 hover:bg-muted/30"
              }`}
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
                    支援 .xlsx, .csv（.xls 請另存為 .xlsx）
                  </p>
                </div>
              )}
            </div>
          </div>

          <Button
            onClick={() => handleExcelUpload(fileType)}
            disabled={!state.file || isProcessing}
            className="w-full"
          >
            {isProcessing ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {isBackgroundJob ? "背景處理中..." : "匯入中..."}
              </>
            ) : (
              <>
                <Upload className="h-4 w-4 mr-2" />
                開始匯入
              </>
            )}
          </Button>

          {/* Background Job Progress */}
          {isBackgroundJob && (state.jobStatus === "pending" || state.jobStatus === "processing") && (
            <div className="space-y-2 p-3 rounded-lg bg-blue-50 border border-blue-200 dark:bg-blue-950/30 dark:border-blue-800">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                  <span className="font-medium text-blue-800 dark:text-blue-300">
                    {state.jobStatus === "pending" ? "準備中..." : "匯入進行中"}
                  </span>
                </div>
                <span className="text-blue-600 dark:text-blue-400 font-mono text-sm">
                  {state.jobProgress}%
                </span>
              </div>
              <Progress value={state.jobProgress} className="h-2" />
              {state.jobDetail && (
                <p className="text-xs text-blue-600 dark:text-blue-400">{state.jobDetail}</p>
              )}
            </div>
          )}

          {/* Result display */}
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
                    <p className="font-medium">
                      匯入成功{state.result.backgroundJob ? "（背景任務）" : ""}
                    </p>
                    {state.result.processed !== undefined && (
                      <p className="text-xs mt-0.5">處理 {Number(state.result.processed).toLocaleString()} 筆記錄</p>
                    )}
                    {state.result.ordersProcessed !== undefined && (
                      <p className="text-xs mt-0.5">
                        訂單 {Number(state.result.ordersProcessed).toLocaleString()} 筆，商品明細 {Number(state.result.itemsProcessed ?? 0).toLocaleString()} 筆
                      </p>
                    )}
                    {state.result.matched !== undefined && (
                      <p className="text-xs mt-0.5">
                        匹配 {Number(state.result.matched).toLocaleString()} 筆，未匹配 {Number(state.result.unmatched ?? 0).toLocaleString()} 筆
                      </p>
                    )}
                    {state.result.errorCount !== undefined && state.result.errorCount > 0 && (
                      <p className="text-xs mt-0.5 text-orange-600">
                        其中 {Number(state.result.errorCount).toLocaleString()} 筆發生錯誤
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
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">數據同步</h1>
        <p className="text-muted-foreground mt-1">
          管理 CRM API 憑證、同步數據或從 Excel 匯入
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
          {/* Info banner for large files */}
          <div className="p-3 rounded-lg bg-blue-50 border border-blue-200 dark:bg-blue-950/30 dark:border-blue-800">
            <div className="flex items-center gap-2 text-sm text-blue-800 dark:text-blue-300">
              <FileSpreadsheet className="h-4 w-4 shrink-0" />
              <span>
                支援大量資料匯入（建議單檔不超過 50MB，約數萬筆）。檔案於本機解析後分批寫入，頁面即時顯示進度；匯入完成後原始檔不保留。
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {canUploadCustomers && renderUploadCard(
              "customers",
              <Users className="h-5 w-5 text-blue-600" />,
              "顧客列表",
              "匯入顧客基本資料（姓名、信箱、電話等）",
              customerUpload,
              customerFileRef,
            )}
            {canUploadOrders && renderUploadCard(
              "orders",
              <ShoppingCart className="h-5 w-5 text-green-600" />,
              "訂單列表",
              "匯入訂單資料（訂編、顧客 Email、金額、商品明細等）",
              orderUpload,
              orderFileRef,
            )}
            {canUploadProducts && renderUploadCard(
              "products",
              <Package className="h-5 w-5 text-purple-600" />,
              "商品列表",
              "匯入商品資料（名稱、SKU、價格、庫存等）",
              productUpload,
              productFileRef,
            )}
            {canUploadLogistics && renderUploadCard(
              "logistics",
              <Truck className="h-5 w-5 text-orange-600" />,
              "訂單物流檔",
              "匯入物流資料（用 PayNow物流單號比對出貨單號碼，寫入配送編號和物流狀態）",
              logisticsUpload,
              logisticsFileRef,
            )}
          </div>

          {/* Clear Data Card */}
          {canClearData && <Card className="border-destructive/30">
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
          </Card>}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">匯入說明</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="prose prose-sm max-w-none text-muted-foreground">
                <ul className="space-y-1.5 list-disc pl-4">
                  <li><strong className="text-foreground">建議匯入順序</strong>：先匯入顧客列表，再匯入訂單列表，然後匯入商品列表，最後匯入訂單物流檔。若先匯訂單、後匯會員也可以，系統會自動關聯並重算統計</li>
                  <li><strong className="text-foreground">訂單物流檔</strong>：系統會用「PayNow物流單號」比對訂單的「出貨單號」，匹配成功後寫入「配送編號」和「物流狀態」</li>
                  <li><strong className="text-foreground">顧客關聯</strong>：顧客以 Email（優先）或手機辨識；匯入訂單後會依信箱／手機關聯顧客，並重算總消費、訂單數、生命週期等（含「已完成」「已出貨」訂單）</li>
                  <li><strong className="text-foreground">消費統計</strong>：會員檔中的「訂單數」「消費金額」不會匯入，數據一律由訂單匯總計算</li>
                  <li><strong className="text-foreground">重複匯入</strong>：同一顧客或訂單（訂編）會自動更新，不會重複建立；同一訂單重新匯入時，明細會先清除再寫入</li>
                  <li><strong className="text-foreground">大量匯入</strong>：檔案於本機解析後分批寫入（每批約 500 筆），全程顯示進度條</li>
                  <li><strong className="text-foreground">檔案大小</strong>：建議單檔不超過 50MB（約可容納數萬筆；會員約 5～10 萬筆、訂單含 SKU 約 2～5 萬張訂單，視欄位內容而定）。超出時請拆分檔案後分批匯入</li>
                  <li>支援 <strong className="text-foreground">.xlsx</strong>、<strong className="text-foreground">.csv</strong> 格式（舊版 .xls 請先另存為 .xlsx）</li>
                  <li><strong className="text-foreground">資料留存</strong>：匯入完成後，上傳的原始檔不保留</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* API Sync Tab */}
        <TabsContent value="api" className="space-y-6 mt-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Credential Management */}
            {canApiCredentials && <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Key className="h-5 w-5 text-primary" />
                  <CardTitle className="text-base">API 憑證管理</CardTitle>
                </div>
                <CardDescription>
                  API 憑證將以 AES-256-CBC 加密後儲存於資料庫，前端僅顯示遮罩值
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
            </Card>}

            <div className="space-y-6">
              {canApiExecute && <Card>
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
              </Card>}

              {canApiStatus && <Card>
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
              </Card>}
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
              <li>API 憑證使用 <strong className="text-foreground">AES-256-CBC</strong> 加密後儲存於資料庫，前端僅顯示遮罩值（前 4 後 4 字元）</li>
              <li>擁有相應權限的使用者才能查看憑證、執行同步和匯入 Excel</li>
              <li>加密金鑰衍生自伺服器端環境變數，不會暴露在前端</li>
              <li>所有匯入／同步 API 需登入驗證並通過細部權限檢查，匯入端點另有請求頻率限制</li>
              <li>正式環境所有流量經由 <strong className="text-foreground">Cloudflare WAF</strong> 防護</li>
              <li>Excel 匯入檔案於<strong className="text-foreground">瀏覽器本機</strong>解析後分批寫入，<strong className="text-foreground">匯入完成後立即清除</strong>，不保留於伺服器或雲端儲存</li>
              <li>寫入資料庫的匯入原始列（rawData）於處理完成後清除，降低個資留存風險</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
