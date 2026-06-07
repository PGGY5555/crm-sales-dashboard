import { useState, useMemo, useCallback, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Search, Download, ChevronLeft, ChevronRight, Filter, X, Trash2, Eye } from "lucide-react";
import { Link } from "wouter";
import { toast } from "sonner";
import { exportToExcelFile } from "@/lib/excelUtils";
import { canGoNextPage, formatDeferredTotal, totalPagesFromCount } from "@/lib/listPagination";
import { flattenOrdersToExportRows, ORDER_EXPORT_COLUMNS } from "@shared/orderExport";
import { usePermissions } from "@/hooks/usePermissions";

const SEARCH_FIELDS = [
  { value: "orderNumber", label: "訂編" },
  { value: "customerName", label: "顧客" },
  { value: "customerPhone", label: "顧客手機" },
  { value: "customerEmail", label: "顧客 Email" },
  { value: "recipientName", label: "收件人名" },
  { value: "recipientPhone", label: "收件人電話" },
  { value: "recipientEmail", label: "收件人信箱" },
  { value: "deliveryNumber", label: "配送編號" },
] as const;

const LOGISTICS_STATUS_OPTIONS = [
  "成功取件",
  "門市退件",
  "門市配達",
  "門市開退",
  "訂單上傳成功",
  "退貨成功",
  "預計退貨",
  "驗收成功",
  "驗收異常",
];

type SearchFieldType = typeof SEARCH_FIELDS[number]["value"];

export default function OrderManagement() {
  const utils = trpc.useUtils();
  const { hasPermission } = usePermissions();
  const canDelete = hasPermission("order_mgmt_delete");
  const canExport = hasPermission("order_mgmt_export");

  // X-axis search
  const [searchField, setSearchField] = useState<SearchFieldType>("customerPhone");
  const [searchValue, setSearchValue] = useState("");

  // Y-axis filters
  const [orderSource, setOrderSource] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [shippingMethod, setShippingMethod] = useState("");
  const [shippingAddress, setShippingAddress] = useState("");
  const [shippedFrom, setShippedFrom] = useState("");
  const [shippedTo, setShippedTo] = useState("");
  const [logisticsStatus, setLogisticsStatus] = useState("");
  const [shippingStatus, setShippingStatus] = useState("");
  const [orderStatusText, setOrderStatusText] = useState("");

  const [page, setPage] = useState(0);
  const [showFilters, setShowFilters] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  // Selection state
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [selectAllMode, setSelectAllMode] = useState(false);
  const [deleteConfirmed, setDeleteConfirmed] = useState(false);

  const selectedIdsKey = useMemo(() => [...selectedIds].sort((a, b) => a - b).join(","), [selectedIds]);

  useEffect(() => {
    setDeleteConfirmed(false);
  }, [selectedIdsKey, selectAllMode]);

  const { data: filterOptions } = trpc.orderMgmt.filterOptions.useQuery(undefined, {
    enabled: showFilters,
  });

  const batchDeleteMutation = trpc.orderMgmt.batchDelete.useMutation({
    onSuccess: (result) => {
      toast.success(`已刪除 ${(result as any).deletedCount ?? (result as any).deleted ?? 0} 筆訂單資料`);
      setSelectedIds(new Set());
      setSelectAllMode(false);
      setDeleteConfirmed(false);
      utils.orderMgmt.list.invalidate();
      utils.orderMgmt.meta.invalidate();
      utils.dashboard.kpi.invalidate();
      utils.dashboard.funnel.invalidate();
      utils.dashboard.lifecycle.invalidate();
      utils.dashboard.trend.invalidate();
      utils.dashboard.salesReps.invalidate();
      utils.dashboard.customers.invalidate();
    },
    onError: (err) => {
      toast.error(`刪除失敗: ${err.message}`);
    },
  });

  const buildFilters = useCallback(() => {
    const filters: Record<string, any> = { page, limit: 50 };
    if (searchValue.trim()) {
      filters.searchField = searchField;
      filters.searchValue = searchValue.trim();
    }
    if (orderSource) filters.orderSource = orderSource;
    if (paymentMethod) filters.paymentMethod = paymentMethod;
    if (shippingMethod) filters.shippingMethod = shippingMethod;
    if (shippingAddress.trim()) filters.shippingAddress = shippingAddress.trim();
    if (shippedFrom) filters.shippedFrom = new Date(shippedFrom);
    if (shippedTo) filters.shippedTo = new Date(shippedTo + "T23:59:59");
    if (logisticsStatus) filters.logisticsStatus = logisticsStatus;
    if (shippingStatus) filters.shippingStatus = shippingStatus;
    if (orderStatusText) filters.orderStatusText = orderStatusText;
    return filters;
  }, [page, searchField, searchValue, orderSource, paymentMethod, shippingMethod, shippingAddress, shippedFrom, shippedTo, logisticsStatus, shippingStatus, orderStatusText]);

  const queryFilters = useMemo(() => buildFilters(), [buildFilters]);

  const listFilters = useMemo(
    () => ({
      ...queryFilters,
      includeTotal: false,
      includeAggregateStats: false,
    }),
    [queryFilters],
  );

  const metaFilters = useMemo(() => queryFilters, [queryFilters]);

  const { data, isLoading, isFetching, isSuccess: listSuccess } = trpc.orderMgmt.list.useQuery(listFilters);
  const listReadyForMeta = listSuccess && !isFetching;
  const { data: meta, isLoading: metaLoading } = trpc.orderMgmt.meta.useQuery(metaFilters, {
    enabled: listReadyForMeta,
  });

  const total = meta?.total ?? data?.total ?? null;
  const aggregateStats = meta?.aggregateStats ?? data?.aggregateStats;
  const tableLoading = isLoading && !data;
  const pageSize = 50;
  const totalPages = totalPagesFromCount(total, pageSize);
  const canGoNext = canGoNextPage(page, pageSize, total, data?.items?.length ?? 0);
  const totalPagesResolved = totalPages ?? (canGoNext ? page + 2 : page + 1);

  const clearAllFilters = () => {
    setSearchValue("");
    setOrderSource("");
    setPaymentMethod("");
    setShippingMethod("");
    setShippingAddress("");
    setShippedFrom("");
    setShippedTo("");
    setLogisticsStatus("");
    setShippingStatus("");
    setOrderStatusText("");
    setPage(0);
  };

  // Selection helpers
  const currentPageIds = useMemo(() => (data?.items || []).map(o => o.id), [data]);
  const allCurrentSelected = currentPageIds.length > 0 && currentPageIds.every(id => selectedIds.has(id));
  const someCurrentSelected = currentPageIds.some(id => selectedIds.has(id));

  const toggleSelectAll = () => {
    if (allCurrentSelected) {
      setSelectedIds(prev => {
        const next = new Set(prev);
        currentPageIds.forEach(id => next.delete(id));
        return next;
      });
      setSelectAllMode(false);
    } else {
      setSelectedIds(prev => {
        const next = new Set(prev);
        currentPageIds.forEach(id => next.add(id));
        return next;
      });
      setSelectAllMode(false);
    }
  };

  const handleSelectAllFiltered = () => {
    setSelectAllMode(true);
  };

  const handleCancelSelectAll = () => {
    setSelectAllMode(false);
    setSelectedIds(new Set());
  };

  const effectiveSelectedCount = selectAllMode ? (total ?? 0) : selectedIds.size;

  // Build filters without page/limit for batch operations
  const buildBatchFilters = useCallback(() => {
    const f: Record<string, any> = {};
    if (searchValue.trim()) {
      f.searchField = searchField;
      f.searchValue = searchValue.trim();
    }
    if (orderSource) f.orderSource = orderSource;
    if (paymentMethod) f.paymentMethod = paymentMethod;
    if (shippingMethod) f.shippingMethod = shippingMethod;
    if (shippingAddress.trim()) f.shippingAddress = shippingAddress.trim();
    if (shippedFrom) f.shippedFrom = new Date(shippedFrom);
    if (shippedTo) f.shippedTo = new Date(shippedTo + "T23:59:59");
    if (logisticsStatus) f.logisticsStatus = logisticsStatus;
    if (shippingStatus) f.shippingStatus = shippingStatus;
    if (orderStatusText) f.orderStatusText = orderStatusText;
    return f;
  }, [searchField, searchValue, orderSource, paymentMethod, shippingMethod, shippingAddress, shippedFrom, shippedTo, logisticsStatus, shippingStatus, orderStatusText]);

  const toggleSelect = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const filters = buildFilters();
      delete (filters as any).page;
      delete (filters as any).limit;

      if (selectedIds.size > 0 && !selectAllMode) {
        (filters as any).ids = Array.from(selectedIds);
      }

      const items = await utils.orderMgmt.export.fetch(filters as any);
      const rows = flattenOrdersToExportRows(items || []);
      if (rows.length === 0) {
        toast.error("沒有可匯出的資料");
        return;
      }
      exportToExcelFile(rows, `訂單資料_${new Date().toISOString().slice(0, 10)}.xlsx`, "訂單資料", [...ORDER_EXPORT_COLUMNS]);
    } catch (err) {
      console.error("Export failed:", err);
      toast.error("匯出失敗，請稍後再試");
    } finally {
      setIsExporting(false);
    }
  };

  const handleBatchDelete = () => {
    if (selectAllMode) {
      batchDeleteMutation.mutate({ filters: buildBatchFilters() });
    } else {
      batchDeleteMutation.mutate({ ids: Array.from(selectedIds) });
    }
  };

  const statusLabel = (status: number | null) => {
    switch (status) {
      case -1: return { text: "已取消", cls: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200" };
      case 2: return { text: "已完成", cls: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" };
      case 1: return { text: "處理中", cls: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200" };
      default: return { text: "待處理", cls: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200" };
    }
  };

  const activeFilterCount = [
    orderSource, paymentMethod, shippingMethod, shippingAddress.trim(), shippedFrom, shippedTo, logisticsStatus, shippingStatus, orderStatusText,
  ].filter(Boolean).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">訂單資料管理</h1>
          <p className="text-muted-foreground text-sm mt-1">
            共 {formatDeferredTotal(total, metaLoading)} 筆訂單資料
            {(selectedIds.size > 0 || selectAllMode) && (
              <span className="ml-2 text-primary font-medium">
                （已{selectAllMode ? '全' : '勾'}選 {effectiveSelectedCount} 筆）
              </span>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          {canDelete && (selectedIds.size > 0 || selectAllMode) && (
            <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-1.5">
              <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                <Checkbox
                  checked={deleteConfirmed}
                  onCheckedChange={(v) => setDeleteConfirmed(v === true)}
                  aria-label="確認刪除所選訂單"
                />
                <span className="text-destructive whitespace-nowrap">確認刪除</span>
              </label>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={!deleteConfirmed || batchDeleteMutation.isPending}
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    {batchDeleteMutation.isPending ? "刪除中..." : `刪除 ${effectiveSelectedCount} 筆`}
                  </Button>
                </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>確認刪除訂單資料</AlertDialogTitle>
                  <AlertDialogDescription>
                    即將刪除 <strong>{effectiveSelectedCount.toLocaleString()}</strong> 筆訂單資料及其訂單明細。
                    {selectAllMode && <span className="block mt-1 text-orange-600 font-medium">注意：您已選取全部符合篩選條件的訂單，不僅限當頁。</span>}
                    此操作無法復原，刪除後各項統計數據（KPI、銷售漏斗、銷售趨勢等）將自動更新。
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>取消</AlertDialogCancel>
                  <AlertDialogAction onClick={handleBatchDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                    確認刪除
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            </div>
          )}
          {canExport && (
            <Button onClick={handleExport} disabled={isExporting || !data?.items?.length} variant="outline" size="sm">
              <Download className="w-4 h-4 mr-2" />
              {isExporting ? "匯出中..." : selectedIds.size > 0 ? `匯出 ${selectedIds.size} 筆` : "匯出 Excel"}
            </Button>
          )}
        </div>
      </div>

      {/* X-axis: Search */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex gap-2 items-center flex-wrap">
            <Select value={searchField} onValueChange={(v) => { setSearchField(v as SearchFieldType); setPage(0); }}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SEARCH_FIELDS.map(f => (
                  <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="輸入搜尋關鍵字..."
                value={searchValue}
                onChange={(e) => { setSearchValue(e.target.value); setPage(0); }}
              />
            </div>
            <Button
              variant={showFilters ? "default" : "outline"}
              onClick={() => setShowFilters(!showFilters)}
              className="relative"
            >
              <Filter className="w-4 h-4 mr-2" />
              進階篩選
              {activeFilterCount > 0 && (
                <span className="absolute -top-2 -right-2 bg-primary text-primary-foreground text-xs rounded-full w-5 h-5 flex items-center justify-center">
                  {activeFilterCount}
                </span>
              )}
            </Button>
            {activeFilterCount > 0 && (
              <Button variant="ghost" size="sm" onClick={clearAllFilters}>
                <X className="w-4 h-4 mr-1" /> 清除篩選
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Y-axis: Advanced Filters */}
      {showFilters && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">進階篩選條件</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">訂單來源</label>
                <Select value={orderSource} onValueChange={v => { setOrderSource(v === "_clear" ? "" : v); setPage(0); }}>
                  <SelectTrigger><SelectValue placeholder="選擇來源" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_clear">全部</SelectItem>
                    {(filterOptions?.sources || []).map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">付款方式</label>
                <Select value={paymentMethod} onValueChange={v => { setPaymentMethod(v === "_clear" ? "" : v); setPage(0); }}>
                  <SelectTrigger><SelectValue placeholder="選擇付款方式" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_clear">全部</SelectItem>
                    {(filterOptions?.payments || []).map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">配送方式</label>
                <Select value={shippingMethod} onValueChange={v => { setShippingMethod(v === "_clear" ? "" : v); setPage(0); }}>
                  <SelectTrigger><SelectValue placeholder="選擇配送方式" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_clear">全部</SelectItem>
                    {(filterOptions?.shippings || []).map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">收貨地址</label>
                <Input placeholder="輸入地址關鍵字..." value={shippingAddress} onChange={e => { setShippingAddress(e.target.value); setPage(0); }} className="text-sm" />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">出貨日期區間</label>
                <div className="flex gap-2 items-center">
                  <Input type="date" value={shippedFrom} onChange={e => { setShippedFrom(e.target.value); setPage(0); }} className="text-sm" />
                  <span className="text-muted-foreground text-sm">至</span>
                  <Input type="date" value={shippedTo} onChange={e => { setShippedTo(e.target.value); setPage(0); }} className="text-sm" />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">物流狀態</label>
                <Select value={logisticsStatus} onValueChange={v => { setLogisticsStatus(v === "_clear" ? "" : v); setPage(0); }}>
                  <SelectTrigger><SelectValue placeholder="選擇物流狀態" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_clear">全部</SelectItem>
                    {LOGISTICS_STATUS_OPTIONS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">訂單狀態</label>
                <Select value={orderStatusText} onValueChange={v => { setOrderStatusText(v === "_clear" ? "" : v); setPage(0); }}>
                  <SelectTrigger><SelectValue placeholder="選擇訂單狀態" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_clear">全部</SelectItem>
                    {(filterOptions?.orderStatuses || []).map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">出貨狀態</label>
                <Select value={shippingStatus} onValueChange={v => { setShippingStatus(v === "_clear" ? "" : v); setPage(0); }}>
                  <SelectTrigger><SelectValue placeholder="選擇出貨狀態" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_clear">全部</SelectItem>
                    {(filterOptions?.shippingStatuses || []).map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Aggregate Stats - only shown when filters are active */}
      {aggregateStats && (
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div className="space-y-1">
                <p className="text-muted-foreground">總計筆數</p>
                <p className="text-lg font-bold">{aggregateStats.totalCount.toLocaleString()} 筆</p>
              </div>
              <div className="space-y-1">
                <p className="text-muted-foreground">黑名單數</p>
                <p className="text-lg font-bold text-red-600">{aggregateStats.blacklistCount.toLocaleString()} 筆</p>
              </div>
              <div className="space-y-1">
                <p className="text-muted-foreground">訂單金額總計</p>
                <p className="text-lg font-bold">${aggregateStats.totalAmount.toLocaleString()}</p>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
              {/* Shipping Distribution */}
              <div className="space-y-2">
                <p className="text-sm font-semibold">配送方式統計</p>
                <div className="space-y-1">
                  {aggregateStats.shippingDistribution.map((s: any) => (
                    <div key={s.method} className="flex justify-between text-sm border-b pb-1">
                      <span>{s.method}</span>
                      <span className="font-medium">{s.count.toLocaleString()} 筆</span>
                    </div>
                  ))}
                </div>
              </div>
              {/* Payment Distribution */}
              <div className="space-y-2">
                <p className="text-sm font-semibold">付款方式統計</p>
                <div className="space-y-1">
                  {aggregateStats.paymentDistribution.map((p: any) => (
                    <div key={p.method} className="flex justify-between text-sm border-b pb-1">
                      <span>{p.method}</span>
                      <span className="font-medium">${p.totalAmount.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {metaLoading && !aggregateStats && showFilters && activeFilterCount > 0 && (
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-sm text-muted-foreground">篩選統計載入中…</p>
          </CardContent>
        </Card>
      )}

      {/* Select All Banner */}
      {allCurrentSelected && !selectAllMode && (total ?? 0) > currentPageIds.length && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 flex items-center justify-between">
          <p className="text-sm text-blue-800">
            已選取當頁 <strong>{currentPageIds.length}</strong> 筆。
          </p>
          <Button
            variant="link"
            size="sm"
            className="text-blue-700 font-medium p-0 h-auto"
            onClick={handleSelectAllFiltered}
          >
            選取全部符合篩選條件的 {formatDeferredTotal(total, metaLoading)} 筆
          </Button>
        </div>
      )}
      {selectAllMode && (
        <div className="bg-blue-100 border border-blue-300 rounded-lg px-4 py-3 flex items-center justify-between">
          <p className="text-sm text-blue-900 font-medium">
            已選取全部符合篩選條件的 <strong>{formatDeferredTotal(total, metaLoading)}</strong> 筆訂單。
            {(total ?? 0) > 5000 && <span className="text-orange-600 ml-2">（批次操作上限 5,000 筆）</span>}
          </p>
          <Button
            variant="link"
            size="sm"
            className="text-blue-700 p-0 h-auto"
            onClick={handleCancelSelectAll}
          >
            取消全選
          </Button>
        </div>
      )}

      {/* Results Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {canDelete && (
                    <TableHead className="w-[40px]">
                      <Checkbox
                        checked={allCurrentSelected}
                        onCheckedChange={toggleSelectAll}
                        aria-label="全選"
                        className={someCurrentSelected && !allCurrentSelected ? "opacity-50" : ""}
                      />
                    </TableHead>
                  )}
                  <TableHead className="min-w-[120px]">訂編</TableHead>
                  <TableHead className="min-w-[60px]">詳情</TableHead>
                  <TableHead className="min-w-[90px]">訂單日期</TableHead>
                  <TableHead className="min-w-[80px]">顧客</TableHead>
                  <TableHead className="min-w-[100px]">顧客手機</TableHead>
                  <TableHead className="min-w-[80px]">收件人名</TableHead>
                  <TableHead className="min-w-[80px]">訂單來源</TableHead>
                  <TableHead className="min-w-[80px]">付款方式</TableHead>
                  <TableHead className="min-w-[80px]">寄送方式</TableHead>
                  <TableHead className="min-w-[100px] text-right">訂單金額</TableHead>
                  <TableHead className="min-w-[70px]">訂單狀態</TableHead>
                  <TableHead className="min-w-[90px]">出貨日期</TableHead>
                  <TableHead className="min-w-[110px]">出貨單號</TableHead>
                  <TableHead className="min-w-[100px]">配送編號</TableHead>
                  <TableHead className="min-w-[80px]">物流狀態</TableHead>
                  <TableHead className="min-w-[80px]">出貨狀態</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tableLoading ? (
                  <TableRow>
                    <TableCell colSpan={17} className="text-center py-8 text-muted-foreground">載入中...</TableCell>
                  </TableRow>
                ) : !data?.items?.length ? (
                  <TableRow>
                    <TableCell colSpan={17} className="text-center py-8 text-muted-foreground">無符合條件的訂單資料</TableCell>
                  </TableRow>
                ) : (
                  data.items.map((o) => {
                    return (
                      <TableRow key={o.id} className={selectedIds.has(o.id) ? "bg-primary/5" : ""}>
                        {canDelete && (
                          <TableCell>
                            <Checkbox
                              checked={selectedIds.has(o.id)}
                              onCheckedChange={() => toggleSelect(o.id)}
                              aria-label={`選取 ${o.externalId}`}
                            />
                          </TableCell>
                        )}
                        <TableCell className="font-mono text-sm">{o.externalId || "-"}</TableCell>
                        <TableCell>
                          <a href={`/order-detail/${o.id}`} target="_blank" rel="noopener noreferrer">
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                              <Eye className="w-4 h-4" />
                            </Button>
                          </a>
                        </TableCell>
                        <TableCell className="text-sm">{o.orderDate ? new Date(o.orderDate).toLocaleDateString("zh-TW") : "-"}</TableCell>
                        <TableCell className="font-medium">{o.customerName || "-"}</TableCell>
                        <TableCell className="text-sm">{o.customerPhone || "-"}</TableCell>
                        <TableCell className="text-sm">{o.recipientName || "-"}</TableCell>
                        <TableCell className="text-sm">{o.orderSource || "-"}</TableCell>
                        <TableCell className="text-sm">{o.paymentMethod || "-"}</TableCell>
                        <TableCell className="text-sm">{o.shippingMethod || "-"}</TableCell>
                        <TableCell className="text-right text-sm font-medium">${parseFloat(String(o.total || "0")).toLocaleString()}</TableCell>
                        <TableCell className="text-sm">{(o as any).orderStatusText || "-"}</TableCell>
                        <TableCell className="text-sm">{o.shippedAt ? new Date(o.shippedAt).toLocaleDateString("zh-TW") : "-"}</TableCell>
                        <TableCell className="text-sm font-mono">{(o as any).shipmentNumber || "-"}</TableCell>
                        <TableCell className="text-sm font-mono">{(o as any).deliveryNumber || "-"}</TableCell>
                        <TableCell className="text-sm">{(o as any).logisticsStatus || "-"}</TableCell>
                        <TableCell className="text-sm">{(o as any).shippingStatus || "-"}</TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          {(totalPagesResolved > 1 || canGoNext || page > 0) && (
            <div className="flex items-center justify-between px-4 py-3 border-t">
              <p className="text-sm text-muted-foreground">
                第 {page + 1}{totalPages != null ? ` / ${totalPages}` : ""} 頁，共 {formatDeferredTotal(total, metaLoading)} 筆
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <Button variant="outline" size="sm" disabled={!canGoNext} onClick={() => setPage(p => p + 1)}>
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
