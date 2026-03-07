import { useState, useMemo, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Search, Download, ChevronLeft, ChevronRight, Filter, X } from "lucide-react";
import * as XLSX from "xlsx";

const SEARCH_FIELDS = [
  { value: "orderNumber", label: "訂單編號" },
  { value: "customerName", label: "顧客姓名" },
  { value: "customerPhone", label: "顧客手機" },
  { value: "customerEmail", label: "顧客信箱" },
  { value: "recipientName", label: "收件人姓名" },
  { value: "recipientPhone", label: "收件人手機" },
  { value: "recipientEmail", label: "收件人信箱" },
] as const;

type SearchFieldType = typeof SEARCH_FIELDS[number]["value"];

export default function OrderManagement() {
  // X-axis search
  const [searchField, setSearchField] = useState<SearchFieldType>("orderNumber");
  const [searchValue, setSearchValue] = useState("");

  // Y-axis filters
  const [orderSource, setOrderSource] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [shippingMethod, setShippingMethod] = useState("");
  const [shippingAddress, setShippingAddress] = useState("");
  const [shippedFrom, setShippedFrom] = useState("");
  const [shippedTo, setShippedTo] = useState("");

  const [page, setPage] = useState(0);
  const [showFilters, setShowFilters] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const { data: filterOptions } = trpc.orderMgmt.filterOptions.useQuery();

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
    return filters;
  }, [page, searchField, searchValue, orderSource, paymentMethod, shippingMethod, shippingAddress, shippedFrom, shippedTo]);

  const queryFilters = useMemo(() => buildFilters(), [buildFilters]);

  const { data, isLoading } = trpc.orderMgmt.list.useQuery(queryFilters);

  const clearAllFilters = () => {
    setSearchValue("");
    setOrderSource("");
    setPaymentMethod("");
    setShippingMethod("");
    setShippingAddress("");
    setShippedFrom("");
    setShippedTo("");
    setPage(0);
  };

  const handleExport = async () => {
    setIsExporting(true);
    try {
      // Export current filtered data
      exportToExcel(data?.items || []);
    } finally {
      setIsExporting(false);
    }
  };

  const exportToExcel = (items: any[]) => {
    const rows = items.map(o => ({
      "訂單編號": o.externalId || "",
      "訂單日期": o.orderDate ? new Date(o.orderDate).toLocaleDateString("zh-TW") : "",
      "顧客姓名": o.customerName || "",
      "顧客手機": o.customerPhone || "",
      "顧客信箱": o.customerEmail || "",
      "收件人姓名": o.recipientName || "",
      "收件人手機": o.recipientPhone || "",
      "收件人信箱": o.recipientEmail || "",
      "訂單來源": o.orderSource || "",
      "付款方式": o.paymentMethod || "",
      "配送方式": o.shippingMethod || "",
      "收貨地址": o.shippingAddress || "",
      "訂單金額": o.total || "0",
      "運費": o.shipmentFee || "0",
      "出貨狀態": o.isShipped ? "已出貨" : "未出貨",
      "出貨日期": o.shippedAt ? new Date(o.shippedAt).toLocaleDateString("zh-TW") : "",
      "訂單狀態": o.orderStatus === -1 ? "已取消" : o.orderStatus === 2 ? "已完成" : o.orderStatus === 1 ? "處理中" : "待處理",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "訂單資料");
    XLSX.writeFile(wb, `訂單資料_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const totalPages = Math.ceil((data?.total || 0) / 50);

  const statusLabel = (status: number | null) => {
    switch (status) {
      case -1: return { text: "已取消", cls: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200" };
      case 2: return { text: "已完成", cls: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" };
      case 1: return { text: "處理中", cls: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200" };
      default: return { text: "待處理", cls: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200" };
    }
  };

  const activeFilterCount = [
    orderSource, paymentMethod, shippingMethod, shippingAddress.trim(), shippedFrom, shippedTo,
  ].filter(Boolean).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">訂單資料管理</h1>
          <p className="text-muted-foreground text-sm mt-1">
            共 {data?.total ?? 0} 筆訂單資料
          </p>
        </div>
        <Button onClick={handleExport} disabled={isExporting || !data?.items?.length} variant="outline">
          <Download className="w-4 h-4 mr-2" />
          {isExporting ? "匯出中..." : "匯出 Excel"}
        </Button>
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
                  <TableHead className="min-w-[120px]">訂單編號</TableHead>
                  <TableHead className="min-w-[90px]">訂單日期</TableHead>
                  <TableHead className="min-w-[80px]">顧客姓名</TableHead>
                  <TableHead className="min-w-[100px]">顧客手機</TableHead>
                  <TableHead className="min-w-[80px]">收件人</TableHead>
                  <TableHead className="min-w-[80px]">訂單來源</TableHead>
                  <TableHead className="min-w-[80px]">付款方式</TableHead>
                  <TableHead className="min-w-[80px]">配送方式</TableHead>
                  <TableHead className="min-w-[100px] text-right">訂單金額</TableHead>
                  <TableHead className="min-w-[70px]">訂單狀態</TableHead>
                  <TableHead className="min-w-[90px]">出貨日期</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={11} className="text-center py-8 text-muted-foreground">載入中...</TableCell>
                  </TableRow>
                ) : !data?.items?.length ? (
                  <TableRow>
                    <TableCell colSpan={11} className="text-center py-8 text-muted-foreground">無符合條件的訂單資料</TableCell>
                  </TableRow>
                ) : (
                  data.items.map((o) => {
                    const status = statusLabel(o.orderStatus);
                    return (
                      <TableRow key={o.id}>
                        <TableCell className="font-mono text-sm">{o.externalId || "-"}</TableCell>
                        <TableCell className="text-sm">{o.orderDate ? new Date(o.orderDate).toLocaleDateString("zh-TW") : "-"}</TableCell>
                        <TableCell className="font-medium">{o.customerName || "-"}</TableCell>
                        <TableCell className="text-sm">{o.customerPhone || "-"}</TableCell>
                        <TableCell className="text-sm">{o.recipientName || "-"}</TableCell>
                        <TableCell className="text-sm">{o.orderSource || "-"}</TableCell>
                        <TableCell className="text-sm">{o.paymentMethod || "-"}</TableCell>
                        <TableCell className="text-sm">{o.shippingMethod || "-"}</TableCell>
                        <TableCell className="text-right text-sm font-medium">${parseFloat(String(o.total || "0")).toLocaleString()}</TableCell>
                        <TableCell>
                          <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${status.cls}`}>{status.text}</span>
                        </TableCell>
                        <TableCell className="text-sm">{o.shippedAt ? new Date(o.shippedAt).toLocaleDateString("zh-TW") : "-"}</TableCell>
                      </TableRow>
                    );
                  })
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
