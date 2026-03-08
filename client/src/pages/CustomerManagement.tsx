import { useState, useMemo, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Search, Download, ChevronLeft, ChevronRight, Filter, X, Trash2, ExternalLink } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Link } from "wouter";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { usePermissions } from "@/hooks/usePermissions";

const SEARCH_FIELDS = [
  { value: "customerName", label: "顧客姓名" },
  { value: "customerPhone", label: "顧客手機" },
  { value: "customerEmail", label: "顧客信箱" },
  { value: "recipientName", label: "收件人姓名" },
  { value: "recipientPhone", label: "收件人手機" },
  { value: "recipientEmail", label: "收件人信箱" },
] as const;

const LIFECYCLE_OPTIONS = [
  { value: "N", label: "N 新鮮客" },
  { value: "A", label: "A 活躍客" },
  { value: "S", label: "S 沉睡客" },
  { value: "L", label: "L 流失客" },
  { value: "D", label: "D 封存客" },
  { value: "O", label: "O 機會客" },
];

const MONTHS = Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: `${i + 1} 月` }));

const COMPARE_OPS = [
  { value: "gt", label: "大於" },
  { value: "lt", label: "小於" },
  { value: "eq", label: "等於" },
];

type SearchFieldType = typeof SEARCH_FIELDS[number]["value"];

export default function CustomerManagement() {
  const utils = trpc.useUtils();
  const { hasPermission } = usePermissions();
  const canDelete = hasPermission("customer_mgmt_delete");
  const canExport = hasPermission("customer_mgmt_export");

  // X-axis search
  const [searchField, setSearchField] = useState<SearchFieldType>("customerName");
  const [searchValue, setSearchValue] = useState("");

  // Y-axis filters
  const [registeredFrom, setRegisteredFrom] = useState("");
  const [registeredTo, setRegisteredTo] = useState("");
  const [birthdayMonth, setBirthdayMonth] = useState<string>("");
  const [tags, setTags] = useState("");
  const [memberLevel, setMemberLevel] = useState("");
  const [creditsOp, setCreditsOp] = useState("");
  const [creditsValue, setCreditsValue] = useState("");
  const [totalSpentOp, setTotalSpentOp] = useState("");
  const [totalSpentValue, setTotalSpentValue] = useState("");
  const [totalOrdersOp, setTotalOrdersOp] = useState("");
  const [totalOrdersValue, setTotalOrdersValue] = useState("");
  const [lastPurchaseFrom, setLastPurchaseFrom] = useState("");
  const [lastPurchaseTo, setLastPurchaseTo] = useState("");
  const [lastPurchaseAmountOp, setLastPurchaseAmountOp] = useState("");
  const [lastPurchaseAmountValue, setLastPurchaseAmountValue] = useState("");
  const [lastShipmentFrom, setLastShipmentFrom] = useState("");
  const [lastShipmentTo, setLastShipmentTo] = useState("");
  const [selectedLifecycles, setSelectedLifecycles] = useState<string[]>([]);
  const [blacklisted, setBlacklisted] = useState("");
  const [lineUid, setLineUid] = useState("");
  const [sfShippedFrom, setSfShippedFrom] = useState("");
  const [sfShippedTo, setSfShippedTo] = useState("");

  const [page, setPage] = useState(0);
  const [showFilters, setShowFilters] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  // Selection state
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const { data: memberLevels } = trpc.customerMgmt.memberLevels.useQuery();

  const batchDeleteMutation = trpc.customerMgmt.batchDelete.useMutation({
    onSuccess: (result) => {
      toast.success(`已刪除 ${result.deleted} 筆客戶資料及其關聯訂單`);
      setSelectedIds(new Set());
      utils.customerMgmt.list.invalidate();
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
    if (registeredFrom) filters.registeredFrom = new Date(registeredFrom);
    if (registeredTo) filters.registeredTo = new Date(registeredTo + "T23:59:59");
    if (birthdayMonth) filters.birthdayMonth = parseInt(birthdayMonth);
    if (tags.trim()) filters.tags = tags.trim();
    if (memberLevel) filters.memberLevel = memberLevel;
    if (creditsOp && creditsValue) { filters.creditsOp = creditsOp; filters.creditsValue = parseFloat(creditsValue); }
    if (totalSpentOp && totalSpentValue) { filters.totalSpentOp = totalSpentOp; filters.totalSpentValue = parseFloat(totalSpentValue); }
    if (totalOrdersOp && totalOrdersValue) { filters.totalOrdersOp = totalOrdersOp; filters.totalOrdersValue = parseInt(totalOrdersValue); }
    if (lastPurchaseFrom) filters.lastPurchaseFrom = new Date(lastPurchaseFrom);
    if (lastPurchaseTo) filters.lastPurchaseTo = new Date(lastPurchaseTo + "T23:59:59");
    if (lastPurchaseAmountOp && lastPurchaseAmountValue) { filters.lastPurchaseAmountOp = lastPurchaseAmountOp; filters.lastPurchaseAmountValue = parseFloat(lastPurchaseAmountValue); }
    if (lastShipmentFrom) filters.lastShipmentFrom = new Date(lastShipmentFrom);
    if (lastShipmentTo) filters.lastShipmentTo = new Date(lastShipmentTo + "T23:59:59");
    if (sfShippedFrom) filters.sfShippedFrom = new Date(sfShippedFrom);
    if (sfShippedTo) filters.sfShippedTo = new Date(sfShippedTo + "T23:59:59");
    if (selectedLifecycles.length > 0) filters.lifecycles = selectedLifecycles;
    if (blacklisted) filters.blacklisted = blacklisted;
    if (lineUid.trim()) filters.lineUid = lineUid.trim();
    return filters;
  }, [page, searchField, searchValue, registeredFrom, registeredTo, birthdayMonth, tags, memberLevel, creditsOp, creditsValue, totalSpentOp, totalSpentValue, totalOrdersOp, totalOrdersValue, lastPurchaseFrom, lastPurchaseTo, lastPurchaseAmountOp, lastPurchaseAmountValue, lastShipmentFrom, lastShipmentTo, sfShippedFrom, sfShippedTo, selectedLifecycles, blacklisted, lineUid]);

  const queryFilters = useMemo(() => buildFilters(), [buildFilters]);

  const { data, isLoading } = trpc.customerMgmt.list.useQuery(queryFilters);

  const clearAllFilters = () => {
    setSearchValue("");
    setRegisteredFrom("");
    setRegisteredTo("");
    setBirthdayMonth("");
    setTags("");
    setMemberLevel("");
    setCreditsOp("");
    setCreditsValue("");
    setTotalSpentOp("");
    setTotalSpentValue("");
    setTotalOrdersOp("");
    setTotalOrdersValue("");
    setLastPurchaseFrom("");
    setLastPurchaseTo("");
    setLastPurchaseAmountOp("");
    setLastPurchaseAmountValue("");
    setLastShipmentFrom("");
    setLastShipmentTo("");
    setSelectedLifecycles([]);
    setBlacklisted("");
    setLineUid("");
    setSfShippedFrom("");
    setSfShippedTo("");
    setPage(0);
  };

  // Selection helpers
  const currentPageIds = useMemo(() => (data?.items || []).map(c => c.id), [data]);
  const allCurrentSelected = currentPageIds.length > 0 && currentPageIds.every(id => selectedIds.has(id));
  const someCurrentSelected = currentPageIds.some(id => selectedIds.has(id));

  const toggleSelectAll = () => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allCurrentSelected) {
        currentPageIds.forEach(id => next.delete(id));
      } else {
        currentPageIds.forEach(id => next.add(id));
      }
      return next;
    });
  };

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
      // If items are selected, export only selected items from current data
      if (selectedIds.size > 0) {
        const selectedItems = (data?.items || []).filter(c => selectedIds.has(c.id));
        exportToExcel(selectedItems);
        return;
      }
      // Otherwise export all filtered results
      const filters = buildFilters();
      delete filters.page;
      delete filters.limit;
      const items = await (window as any).__trpcClient?.customerMgmt.export.query(filters);
      if (!items) {
        exportToExcel(data?.items || []);
        return;
      }
      exportToExcel(items);
    } catch {
      exportToExcel(data?.items || []);
    } finally {
      setIsExporting(false);
    }
  };

  const exportToExcel = (items: any[]) => {
    const rows = items.map(c => ({
      "顧客姓名": c.name || "",
      "電子信箱": c.email || "",
      "手機": c.phone || "",
      "生日": c.birthday || "",
      "會員等級": c.memberLevel || "",
      "會員標籤": c.tags || "",
      "購物金餘額": c.credits || "0",
      "累積消費金額": c.totalSpent || "0",
      "累積消費次數": c.totalOrders || 0,
      "最後購買日期": c.lastPurchaseDate ? new Date(c.lastPurchaseDate).toLocaleDateString("zh-TW") : "",
      "最後消費金額": c.lastPurchaseAmount || "",
      "最後出貨日期": c.lastShipmentAt ? new Date(c.lastShipmentAt).toLocaleDateString("zh-TW") : "",
      "SF出貨日": c.sfShippedAt ? new Date(c.sfShippedAt).toLocaleDateString("zh-TW") : "",
      "生命週期": c.lifecycle || "",
      "收件人姓名": c.recipientName || "",
      "收件人手機": c.recipientPhone || "",
      "收件人信箱": c.recipientEmail || "",
      "注冊日期": c.registeredAt ? new Date(c.registeredAt).toLocaleDateString("zh-TW") : "",
      "顧客備註": c.notes || "",
      "黑名單": c.blacklisted || "否",
      "LINE UID": c.lineUid || "",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "客戶資料");
    XLSX.writeFile(wb, `客戶資料_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const handleBatchDelete = () => {
    batchDeleteMutation.mutate({ ids: Array.from(selectedIds) });
  };

  const totalPages = Math.ceil((data?.total || 0) / 50);

  const toggleLifecycle = (lc: string) => {
    setSelectedLifecycles(prev =>
      prev.includes(lc) ? prev.filter(l => l !== lc) : [...prev, lc]
    );
    setPage(0);
  };

  const lifecycleBadgeColor = (lc: string) => {
    const colors: Record<string, string> = {
      N: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
      A: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
      S: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
      L: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
      D: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
      O: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
    };
    return colors[lc] || "bg-gray-100 text-gray-800";
  };

  const activeFilterCount = [
    registeredFrom, registeredTo, birthdayMonth, tags, memberLevel,
    creditsOp && creditsValue, totalSpentOp && totalSpentValue,
    totalOrdersOp && totalOrdersValue, lastPurchaseFrom, lastPurchaseTo,
    lastPurchaseAmountOp && lastPurchaseAmountValue, lastShipmentFrom, lastShipmentTo,
    sfShippedFrom, sfShippedTo,
    selectedLifecycles.length > 0, blacklisted, lineUid,
  ].filter(Boolean).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">客戶資料管理</h1>
          <p className="text-muted-foreground text-sm mt-1">
            共 {data?.total ?? 0} 筆客戶資料
            {selectedIds.size > 0 && (
              <span className="ml-2 text-primary font-medium">
                （已勾選 {selectedIds.size} 筆）
              </span>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          {canDelete && selectedIds.size > 0 && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm" disabled={batchDeleteMutation.isPending}>
                  <Trash2 className="w-4 h-4 mr-2" />
                  {batchDeleteMutation.isPending ? "刪除中..." : `刪除 ${selectedIds.size} 筆`}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>確認刪除客戶資料</AlertDialogTitle>
                  <AlertDialogDescription>
                    即將刪除 <strong>{selectedIds.size}</strong> 筆客戶資料及其所有關聯訂單。
                    此操作無法復原，刪除後各項統計數據（KPI、銷售漏斗、客戶分析等）將自動更新。
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
            {/* Row 1: Date ranges */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">註冊日期區間</label>
                <div className="flex gap-2 items-center">
                  <Input type="date" value={registeredFrom} onChange={e => { setRegisteredFrom(e.target.value); setPage(0); }} className="text-sm" />
                  <span className="text-muted-foreground text-sm">至</span>
                  <Input type="date" value={registeredTo} onChange={e => { setRegisteredTo(e.target.value); setPage(0); }} className="text-sm" />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">最後購買日期區間</label>
                <div className="flex gap-2 items-center">
                  <Input type="date" value={lastPurchaseFrom} onChange={e => { setLastPurchaseFrom(e.target.value); setPage(0); }} className="text-sm" />
                  <span className="text-muted-foreground text-sm">至</span>
                  <Input type="date" value={lastPurchaseTo} onChange={e => { setLastPurchaseTo(e.target.value); setPage(0); }} className="text-sm" />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">最後出貨日期區間</label>
                <div className="flex gap-2 items-center">
                  <Input type="date" value={lastShipmentFrom} onChange={e => { setLastShipmentFrom(e.target.value); setPage(0); }} className="text-sm" />
                  <span className="text-muted-foreground text-sm">至</span>
                  <Input type="date" value={lastShipmentTo} onChange={e => { setLastShipmentTo(e.target.value); setPage(0); }} className="text-sm" />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">SF出貨日區間</label>
                <div className="flex gap-2 items-center">
                  <Input type="date" value={sfShippedFrom} onChange={e => { setSfShippedFrom(e.target.value); setPage(0); }} className="text-sm" />
                  <span className="text-muted-foreground text-sm">至</span>
                  <Input type="date" value={sfShippedTo} onChange={e => { setSfShippedTo(e.target.value); setPage(0); }} className="text-sm" />
                </div>
              </div>
            </div>

            {/* Row 2: Dropdowns */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">生日月份</label>
                <Select value={birthdayMonth} onValueChange={v => { setBirthdayMonth(v === "_clear" ? "" : v); setPage(0); }}>
                  <SelectTrigger><SelectValue placeholder="選擇月份" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_clear">全部</SelectItem>
                    {MONTHS.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">會員等級</label>
                <Select value={memberLevel} onValueChange={v => { setMemberLevel(v === "_clear" ? "" : v); setPage(0); }}>
                  <SelectTrigger><SelectValue placeholder="選擇等級" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_clear">全部</SelectItem>
                    {(memberLevels || []).map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">顧客標籤</label>
                <Input placeholder="例：膠原,體驗" value={tags} onChange={e => { setTags(e.target.value); setPage(0); }} className="text-sm" />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">黑名單</label>
                <Select value={blacklisted} onValueChange={v => { setBlacklisted(v === "_clear" ? "" : v); setPage(0); }}>
                  <SelectTrigger><SelectValue placeholder="全部" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_clear">全部</SelectItem>
                    <SelectItem value="是">是</SelectItem>
                    <SelectItem value="否">否</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">LINE UID</label>
                <Input placeholder="輸入 LINE UID" value={lineUid} onChange={e => { setLineUid(e.target.value); setPage(0); }} className="text-sm" />
              </div>
            </div>

            {/* Row 2b: Lifecycle */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">生命週期分類</label>
                <div className="flex flex-wrap gap-1.5">
                  {LIFECYCLE_OPTIONS.map(lc => (
                    <button
                      key={lc.value}
                      onClick={() => toggleLifecycle(lc.value)}
                      className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                        selectedLifecycles.includes(lc.value)
                          ? lifecycleBadgeColor(lc.value) + " ring-2 ring-offset-1 ring-primary"
                          : "bg-muted text-muted-foreground hover:bg-muted/80"
                      }`}
                    >
                      {lc.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Row 3: Numeric comparisons */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">持有購物金</label>
                <div className="flex gap-1.5">
                  <Select value={creditsOp} onValueChange={v => { setCreditsOp(v === "_clear" ? "" : v); setPage(0); }}>
                    <SelectTrigger className="w-[80px]"><SelectValue placeholder="條件" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_clear">-</SelectItem>
                      {COMPARE_OPS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Input type="number" placeholder="金額" value={creditsValue} onChange={e => { setCreditsValue(e.target.value); setPage(0); }} className="text-sm" />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">累積消費金額</label>
                <div className="flex gap-1.5">
                  <Select value={totalSpentOp} onValueChange={v => { setTotalSpentOp(v === "_clear" ? "" : v); setPage(0); }}>
                    <SelectTrigger className="w-[80px]"><SelectValue placeholder="條件" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_clear">-</SelectItem>
                      {COMPARE_OPS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Input type="number" placeholder="金額" value={totalSpentValue} onChange={e => { setTotalSpentValue(e.target.value); setPage(0); }} className="text-sm" />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">累積消費次數</label>
                <div className="flex gap-1.5">
                  <Select value={totalOrdersOp} onValueChange={v => { setTotalOrdersOp(v === "_clear" ? "" : v); setPage(0); }}>
                    <SelectTrigger className="w-[80px]"><SelectValue placeholder="條件" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_clear">-</SelectItem>
                      {COMPARE_OPS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Input type="number" placeholder="次數" value={totalOrdersValue} onChange={e => { setTotalOrdersValue(e.target.value); setPage(0); }} className="text-sm" />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">最後消費金額</label>
                <div className="flex gap-1.5">
                  <Select value={lastPurchaseAmountOp} onValueChange={v => { setLastPurchaseAmountOp(v === "_clear" ? "" : v); setPage(0); }}>
                    <SelectTrigger className="w-[80px]"><SelectValue placeholder="條件" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_clear">-</SelectItem>
                      {COMPARE_OPS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Input type="number" placeholder="金額" value={lastPurchaseAmountValue} onChange={e => { setLastPurchaseAmountValue(e.target.value); setPage(0); }} className="text-sm" />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Aggregate Stats - only shown when filters are active */}
      {data?.aggregateStats && (
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4 text-sm">
              <div className="space-y-1">
                <p className="text-muted-foreground">總計筆數</p>
                <p className="text-lg font-bold">{data.aggregateStats.totalCount.toLocaleString()} 筆</p>
              </div>
              <div className="space-y-1">
                <p className="text-muted-foreground">黑名單數</p>
                <p className="text-lg font-bold text-red-600">{data.aggregateStats.blacklistCount.toLocaleString()} 筆</p>
              </div>
              <div className="space-y-1">
                <p className="text-muted-foreground">消費 0 次</p>
                <p className="text-lg font-bold">{data.aggregateStats.orders0.toLocaleString()} 筆</p>
              </div>
              <div className="space-y-1">
                <p className="text-muted-foreground">消費 1 次</p>
                <p className="text-lg font-bold">{data.aggregateStats.orders1.toLocaleString()} 筆</p>
              </div>
              <div className="space-y-1">
                <p className="text-muted-foreground">消費 2 次</p>
                <p className="text-lg font-bold">{data.aggregateStats.orders2.toLocaleString()} 筆</p>
              </div>
              <div className="space-y-1">
                <p className="text-muted-foreground">消費 3 次以上</p>
                <p className="text-lg font-bold">{data.aggregateStats.orders3plus.toLocaleString()} 筆</p>
              </div>
              <div className="space-y-1">
                <p className="text-muted-foreground">累消金額總計</p>
                <p className="text-lg font-bold">${data.aggregateStats.totalSpentSum.toLocaleString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>
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
                  <TableHead className="min-w-[100px]">註冊日期</TableHead>
                  <TableHead className="min-w-[100px]">顧客姓名</TableHead>
                  <TableHead className="min-w-[120px]">電子信箱</TableHead>
                  <TableHead className="min-w-[100px]">手機</TableHead>
                  <TableHead className="min-w-[80px]">會員等級</TableHead>
                  <TableHead className="min-w-[60px]">生命週期</TableHead>
                  <TableHead className="min-w-[60px]">黑名單</TableHead>
                  <TableHead className="min-w-[80px]">標籤</TableHead>
                  <TableHead className="min-w-[100px]">最後出貨</TableHead>
                  <TableHead className="min-w-[100px] text-right">累積消費</TableHead>
                  <TableHead className="min-w-[60px] text-right">消費次數</TableHead>
                  <TableHead className="min-w-[100px]">最後購買</TableHead>
                  <TableHead className="min-w-[80px] text-right">購物金</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={13} className="text-center py-8 text-muted-foreground">載入中...</TableCell>
                  </TableRow>
                ) : !data?.items?.length ? (
                  <TableRow>
                    <TableCell colSpan={13} className="text-center py-8 text-muted-foreground">無符合條件的客戶資料</TableCell>
                  </TableRow>
                ) : (
                  data.items.map((c) => (
                    <TableRow key={c.id} className={selectedIds.has(c.id) ? "bg-primary/5" : ""}>
                      {canDelete && (
                        <TableCell>
                          <Checkbox
                            checked={selectedIds.has(c.id)}
                            onCheckedChange={() => toggleSelect(c.id)}
                            aria-label={`選取 ${c.name}`}
                          />
                        </TableCell>
                      )}
                      <TableCell className="text-sm">{c.registeredAt ? new Date(c.registeredAt).toLocaleDateString("zh-TW") : "-"}</TableCell>
                      <TableCell className="font-medium">
                        <Link href={`/customer/${c.id}`} className="text-primary hover:underline inline-flex items-center gap-1">
                          {c.name || "-"}
                          <ExternalLink className="w-3 h-3" />
                        </Link>
                      </TableCell>
                      <TableCell className="text-sm">{c.email || "-"}</TableCell>
                      <TableCell className="text-sm">{c.phone || "-"}</TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">{c.memberLevel || "-"}</Badge></TableCell>
                      <TableCell>
                        <TooltipProvider delayDuration={200}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className={`px-1.5 py-0.5 rounded text-xs font-medium cursor-help ${lifecycleBadgeColor(c.lifecycle || "O")}`}>
                                {c.lifecycle || "O"}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="text-xs space-y-1">
                              <p className="font-semibold">{LIFECYCLE_OPTIONS.find(o => o.value === (c.lifecycle || "O"))?.label || c.lifecycle}</p>
                              <p>180天內出貨：{(c as any).ordersIn6m ?? 0} 次</p>
                              <p>180-365天出貨：{(c as any).ordersIn6to12m ?? 0} 次</p>
                              <p>歷史總訂單：{c.totalOrders ?? 0} 次</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </TableCell>
                      <TableCell className="text-sm">
                        <span className={c.blacklisted === "是" ? "text-red-600 font-medium" : ""}>
                          {c.blacklisted || "否"}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm max-w-[120px] truncate" title={c.tags || ""}>{c.tags || "-"}</TableCell>
                      <TableCell className="text-sm">{c.lastShipmentAt ? new Date(c.lastShipmentAt).toLocaleDateString("zh-TW") : "-"}</TableCell>
                      <TableCell className="text-right text-sm font-medium">${parseFloat(String(c.totalSpent || "0")).toLocaleString()}</TableCell>
                      <TableCell className="text-right text-sm">{c.totalOrders}</TableCell>
                      <TableCell className="text-sm">{c.lastPurchaseDate ? new Date(c.lastPurchaseDate).toLocaleDateString("zh-TW") : "-"}</TableCell>
                      <TableCell className="text-right text-sm">{parseFloat(String(c.credits || "0")).toLocaleString()}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t">
              <p className="text-sm text-muted-foreground">
                第 {page + 1} / {totalPages} 頁，共 {data?.total || 0} 筆
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
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
