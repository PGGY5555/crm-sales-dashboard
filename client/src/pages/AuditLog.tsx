import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollText, Search, ChevronLeft, ChevronRight, Loader2, Eye, Filter, X } from "lucide-react";

const CATEGORY_OPTIONS = [
  { value: "all", label: "全部類別" },
  { value: "使用者管理", label: "使用者管理" },
  { value: "客戶管理", label: "客戶管理" },
  { value: "訂單管理", label: "訂單管理" },
  { value: "數據同步", label: "數據同步" },
  { value: "系統設定", label: "系統設定" },
  { value: "登入登出", label: "登入登出" },
  { value: "Excel匯入", label: "Excel匯入" },
  { value: "資料匯出", label: "資料匯出" },
  { value: "資料刪除", label: "資料刪除" },
];

const ACTION_BADGE_MAP: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; label?: string }> = {
  create_user: { variant: "default" },
  remove_user: { variant: "destructive" },
  update_role: { variant: "secondary" },
  update_permissions: { variant: "secondary" },
  login: { variant: "default" },
  logout: { variant: "outline" },
  import_customers: { variant: "default" },
  import_orders: { variant: "default" },
  import_products: { variant: "default" },
  import_logistics: { variant: "default" },
  export_customers: { variant: "secondary" },
  export_orders: { variant: "secondary" },
  delete_customers: { variant: "destructive" },
  delete_orders: { variant: "destructive" },
  clear_data: { variant: "destructive" },
  update_customer: { variant: "secondary" },
  sync_api: { variant: "default" },
  save_setting: { variant: "secondary" },
};

export default function AuditLog() {
  const { user: currentUser } = useAuth();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [category, setCategory] = useState("all");
  const [detailLog, setDetailLog] = useState<any>(null);
  const pageSize = 30;

  const queryInput = useMemo(() => ({
    page,
    pageSize,
    category: category === "all" ? undefined : category,
    search: search || undefined,
  }), [page, pageSize, category, search]);

  const logsQuery = trpc.auditLog.list.useQuery(queryInput);

  const totalPages = Math.ceil((logsQuery.data?.total ?? 0) / pageSize);

  const handleSearch = () => {
    setSearch(searchInput);
    setPage(1);
  };

  const clearFilters = () => {
    setSearch("");
    setSearchInput("");
    setCategory("all");
    setPage(1);
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
        <h1 className="text-2xl font-bold tracking-tight">操作日誌</h1>
        <p className="text-muted-foreground mt-1">追蹤系統中所有關鍵操作的記錄</p>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex flex-1 gap-2">
              <Input
                placeholder="搜尋描述、使用者名稱或 Email..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                className="flex-1"
              />
              <Button variant="outline" size="icon" onClick={handleSearch}>
                <Search className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex gap-2">
              <Select value={category} onValueChange={(v) => { setCategory(v); setPage(1); }}>
                <SelectTrigger className="w-[150px]">
                  <Filter className="h-4 w-4 mr-2" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORY_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {(search || category !== "all") && (
                <Button variant="ghost" size="icon" onClick={clearFilters} title="清除篩選">
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Log Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ScrollText className="h-5 w-5" />
            日誌記錄
            {logsQuery.data && (
              <Badge variant="secondary" className="ml-2">
                共 {logsQuery.data.total} 筆
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {logsQuery.isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden md:block overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[170px]">時間</TableHead>
                      <TableHead className="w-[100px]">類別</TableHead>
                      <TableHead className="w-[130px]">操作</TableHead>
                      <TableHead className="w-[120px]">使用者</TableHead>
                      <TableHead>描述</TableHead>
                      <TableHead className="w-[60px] text-right">詳情</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {logsQuery.data?.logs.map((log) => (
                      <TableRow key={log.id}>
                        <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                          {new Date(log.createdAt).toLocaleString("zh-TW")}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">{log.category}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={ACTION_BADGE_MAP[log.action]?.variant ?? "secondary"}
                            className="text-xs"
                          >
                            {log.action}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">
                          {log.userName || log.userEmail || "-"}
                        </TableCell>
                        <TableCell className="text-sm max-w-[300px] truncate">
                          {(log.description as string) || "-"}
                        </TableCell>
                        <TableCell className="text-right">
                          {!!log.details && (
                            <Button variant="ghost" size="sm" onClick={() => setDetailLog(log)}>
                              <Eye className="h-4 w-4" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                    {(!logsQuery.data?.logs || logsQuery.data.logs.length === 0) && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                          尚無操作日誌記錄
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile card layout */}
              <div className="md:hidden space-y-3">
                {logsQuery.data?.logs.map((log) => (
                  <div key={log.id} className="border rounded-lg p-3 space-y-2">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className="text-xs">{log.category}</Badge>
                        <Badge
                          variant={ACTION_BADGE_MAP[log.action]?.variant ?? "secondary"}
                          className="text-xs"
                        >
                          {log.action}
                        </Badge>
                      </div>
                      {!!log.details && (
                        <Button variant="ghost" size="sm" onClick={() => setDetailLog(log)}>
                          <Eye className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                    <p className="text-sm">{(log.description as string) || "-"}</p>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{log.userName || log.userEmail || "-"}</span>
                      <span>{new Date(log.createdAt).toLocaleString("zh-TW")}</span>
                    </div>
                  </div>
                ))}
                {(!logsQuery.data?.logs || logsQuery.data.logs.length === 0) && (
                  <div className="text-center py-8 text-muted-foreground">
                    尚無操作日誌記錄
                  </div>
                )}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-4 pt-4 border-t">
                  <p className="text-sm text-muted-foreground">
                    第 {page} / {totalPages} 頁，共 {logsQuery.data?.total ?? 0} 筆
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page <= 1}
                      onClick={() => setPage(p => p - 1)}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page >= totalPages}
                      onClick={() => setPage(p => p + 1)}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Detail Dialog */}
      <Dialog open={!!detailLog} onOpenChange={(v) => !v && setDetailLog(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>操作詳情</DialogTitle>
          </DialogHeader>
          {detailLog && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-[100px_1fr] gap-2">
                <span className="text-muted-foreground">時間</span>
                <span>{new Date(detailLog.createdAt).toLocaleString("zh-TW")}</span>
                <span className="text-muted-foreground">類別</span>
                <span>{detailLog.category}</span>
                <span className="text-muted-foreground">操作</span>
                <span>{detailLog.action}</span>
                <span className="text-muted-foreground">使用者</span>
                <span>{detailLog.userName || "-"} ({detailLog.userEmail || "-"})</span>
                <span className="text-muted-foreground">描述</span>
                <span>{detailLog.description || "-"}</span>
                {detailLog.ipAddress && (
                  <>
                    <span className="text-muted-foreground">IP 位址</span>
                    <span>{detailLog.ipAddress}</span>
                  </>
                )}
              </div>
              {detailLog.details && (
                <div>
                  <p className="text-muted-foreground mb-1">詳細資料</p>
                  <pre className="bg-muted p-3 rounded-md text-xs overflow-auto max-h-[300px]">
                    {JSON.stringify(detailLog.details, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
