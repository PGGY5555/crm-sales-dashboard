import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useState, useMemo } from "react";
import {
  Search,
  ChevronLeft,
  ChevronRight,
  Users,
  DollarSign,
  ShoppingCart,
  CalendarClock,
  Repeat,
  TrendingUp,
} from "lucide-react";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  Legend,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  AreaChart,
  Area,
} from "recharts";

const LIFECYCLE_OPTIONS = [
  { value: "N", label: "N 新鮮客", color: "#6366f1", desc: "半年內買一次" },
  { value: "A", label: "A 活躍客", color: "#22c55e", desc: "半年內買一次以上" },
  { value: "S", label: "S 沉睡客", color: "#f59e0b", desc: "半年內沒買，一年內買一次以上" },
  { value: "L", label: "L 流失客", color: "#ef4444", desc: "半年內沒買，一年內僅買一次" },
  { value: "D", label: "D 封存客", color: "#6b7280", desc: "一年內都沒買" },
  { value: "O", label: "O 機會客", color: "#06b6d4", desc: "一年內沒買但有一年內註冊" },
];

export default function Customers() {
  const [selectedLifecycles, setSelectedLifecycles] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);

  const queryInput = useMemo(() => ({
    page,
    limit: 20,
    search: search || undefined,
    lifecycles: selectedLifecycles.length > 0 ? selectedLifecycles : undefined,
  }), [page, search, selectedLifecycles]);

  const lifecycleFilter = useMemo(() => ({
    lifecycles: selectedLifecycles.length > 0 ? selectedLifecycles : undefined,
  }), [selectedLifecycles]);

  const { data: customerData, isLoading: customersLoading } =
    trpc.dashboard.customers.useQuery(queryInput);

  const { data: lifecycle, isLoading: lifecycleLoading } =
    trpc.dashboard.lifecycle.useQuery(lifecycleFilter);

  const { data: analyticsStats, isLoading: statsLoading } =
    trpc.dashboard.customerAnalyticsStats.useQuery(lifecycleFilter);

  const { data: registrationTrend, isLoading: trendLoading } =
    trpc.dashboard.customerRegistrationTrend.useQuery(lifecycleFilter);

  const toggleLifecycle = (val: string) => {
    setSelectedLifecycles((prev) =>
      prev.includes(val) ? prev.filter((v) => v !== val) : [...prev, val]
    );
    setPage(0);
  };

  const totalPages = customerData
    ? Math.ceil(customerData.total / 20)
    : 0;

  const getLifecycleBadge = (lc: string | null) => {
    const opt = LIFECYCLE_OPTIONS.find((o) => o.value === lc);
    if (!opt) return <Badge variant="outline">未知</Badge>;
    return (
      <Badge
        style={{ backgroundColor: opt.color, color: "#fff" }}
        className="text-xs"
      >
        {opt.label}
      </Badge>
    );
  };

  const formatCurrency = (val: number) => {
    if (val >= 1000000) return `$${(val / 1000000).toFixed(1)}M`;
    if (val >= 1000) return `$${(val / 1000).toFixed(0)}K`;
    return `$${val.toFixed(0)}`;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">客戶分析</h1>
        <p className="text-muted-foreground mt-1">
          客戶生命週期分類、回購天數與詳細資料
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {statsLoading ? (
          [...Array(6)].map((_, i) => <Skeleton key={i} className="h-24" />)
        ) : analyticsStats ? (
          <>
            <Card className="bg-gradient-to-br from-blue-50 to-blue-100/50 dark:from-blue-950/30 dark:to-blue-900/20 border-blue-200/50 dark:border-blue-800/30">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400 mb-1">
                  <Users className="h-4 w-4" />
                  <span className="text-xs font-medium">總客戶數</span>
                </div>
                <p className="text-xl font-bold">{analyticsStats.totalCustomers.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  有消費 {analyticsStats.activeCustomers.toLocaleString()}
                </p>
              </CardContent>
            </Card>
            <Card className="bg-gradient-to-br from-green-50 to-green-100/50 dark:from-green-950/30 dark:to-green-900/20 border-green-200/50 dark:border-green-800/30">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-green-600 dark:text-green-400 mb-1">
                  <DollarSign className="h-4 w-4" />
                  <span className="text-xs font-medium">總營收</span>
                </div>
                <p className="text-xl font-bold">{formatCurrency(analyticsStats.totalRevenue)}</p>
              </CardContent>
            </Card>
            <Card className="bg-gradient-to-br from-purple-50 to-purple-100/50 dark:from-purple-950/30 dark:to-purple-900/20 border-purple-200/50 dark:border-purple-800/30">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-purple-600 dark:text-purple-400 mb-1">
                  <ShoppingCart className="h-4 w-4" />
                  <span className="text-xs font-medium">平均消費</span>
                </div>
                <p className="text-xl font-bold">{formatCurrency(analyticsStats.avgSpent)}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  均 {analyticsStats.avgOrders.toFixed(1)} 次
                </p>
              </CardContent>
            </Card>
            <Card className="bg-gradient-to-br from-orange-50 to-orange-100/50 dark:from-orange-950/30 dark:to-orange-900/20 border-orange-200/50 dark:border-orange-800/30">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-orange-600 dark:text-orange-400 mb-1">
                  <CalendarClock className="h-4 w-4" />
                  <span className="text-xs font-medium">平均回購天數</span>
                </div>
                <p className="text-xl font-bold">
                  {analyticsStats.avgRepurchaseDays > 0
                    ? `${analyticsStats.avgRepurchaseDays} 天`
                    : "—"}
                </p>
              </CardContent>
            </Card>
            <Card className="bg-gradient-to-br from-rose-50 to-rose-100/50 dark:from-rose-950/30 dark:to-rose-900/20 border-rose-200/50 dark:border-rose-800/30">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-rose-600 dark:text-rose-400 mb-1">
                  <Repeat className="h-4 w-4" />
                  <span className="text-xs font-medium">回購率</span>
                </div>
                <p className="text-xl font-bold">{analyticsStats.repurchaseRate.toFixed(1)}%</p>
              </CardContent>
            </Card>
            <Card className="bg-gradient-to-br from-teal-50 to-teal-100/50 dark:from-teal-950/30 dark:to-teal-900/20 border-teal-200/50 dark:border-teal-800/30">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-teal-600 dark:text-teal-400 mb-1">
                  <TrendingUp className="h-4 w-4" />
                  <span className="text-xs font-medium">客單價</span>
                </div>
                <p className="text-xl font-bold">
                  {analyticsStats.activeCustomers > 0
                    ? formatCurrency(analyticsStats.totalRevenue / analyticsStats.activeCustomers)
                    : "—"}
                </p>
              </CardContent>
            </Card>
          </>
        ) : null}
      </div>

      {/* Lifecycle Filter Chips */}
      <div className="flex flex-wrap gap-2">
        {LIFECYCLE_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => toggleLifecycle(opt.value)}
            className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium border transition-all ${
              selectedLifecycles.includes(opt.value)
                ? "border-transparent text-white shadow-sm"
                : "border-border bg-background text-foreground hover:bg-muted"
            }`}
            style={
              selectedLifecycles.includes(opt.value)
                ? { backgroundColor: opt.color }
                : {}
            }
          >
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: opt.color }}
            />
            {opt.label}
          </button>
        ))}
        {selectedLifecycles.length > 0 && (
          <button
            onClick={() => {
              setSelectedLifecycles([]);
              setPage(0);
            }}
            className="text-sm text-muted-foreground hover:text-foreground px-2"
          >
            清除篩選
          </button>
        )}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">生命週期分佈</CardTitle>
          </CardHeader>
          <CardContent>
            {lifecycleLoading ? (
              <Skeleton className="h-[280px] w-full" />
            ) : lifecycle && lifecycle.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={lifecycle}
                    dataKey="count"
                    nameKey="label"
                    cx="50%"
                    cy="50%"
                    outerRadius={90}
                    innerRadius={50}
                    paddingAngle={2}
                  >
                    {lifecycle.map((entry) => {
                      const opt = LIFECYCLE_OPTIONS.find(
                        (o) => o.value === entry.lifecycle
                      );
                      return (
                        <Cell
                          key={entry.lifecycle}
                          fill={opt?.color || "#6b7280"}
                        />
                      );
                    })}
                  </Pie>
                  <Tooltip
                    formatter={(value: number, name: string) => [
                      `${value.toLocaleString()} 人`,
                      name,
                    ]}
                    contentStyle={{
                      borderRadius: "8px",
                      border: "1px solid var(--border)",
                      background: "var(--card)",
                    }}
                  />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: "12px" }} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[280px] flex items-center justify-center text-muted-foreground">
                暫無數據
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">各分類消費總額</CardTitle>
          </CardHeader>
          <CardContent>
            {lifecycleLoading ? (
              <Skeleton className="h-[280px] w-full" />
            ) : lifecycle && lifecycle.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={lifecycle} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis
                    type="number"
                    tick={{ fontSize: 12 }}
                    tickFormatter={(v) =>
                      v >= 1000 ? `$${(v / 1000).toFixed(0)}K` : `$${v}`
                    }
                  />
                  <YAxis type="category" dataKey="label" tick={{ fontSize: 12 }} width={80} />
                  <Tooltip
                    formatter={(value: number) => [`$${value.toLocaleString()}`, "消費總額"]}
                    contentStyle={{
                      borderRadius: "8px",
                      border: "1px solid var(--border)",
                      background: "var(--card)",
                    }}
                  />
                  <Bar dataKey="totalSpent" radius={[0, 4, 4, 0]}>
                    {lifecycle.map((entry) => {
                      const opt = LIFECYCLE_OPTIONS.find(
                        (o) => o.value === entry.lifecycle
                      );
                      return (
                        <Cell
                          key={entry.lifecycle}
                          fill={opt?.color || "#6b7280"}
                        />
                      );
                    })}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[280px] flex items-center justify-center text-muted-foreground">
                暫無數據
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Registration Trend Area Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">客戶註冊趨勢（月）</CardTitle>
        </CardHeader>
        <CardContent>
          {trendLoading ? (
            <Skeleton className="h-[280px] w-full" />
          ) : registrationTrend && registrationTrend.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={registrationTrend}>
                <defs>
                  <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="colorSpent" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v) => {
                    const parts = v.split("-");
                    return `${parts[0].slice(2)}/${parts[1]}`;
                  }}
                />
                <YAxis
                  yAxisId="left"
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v) => v.toLocaleString()}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v) => formatCurrency(v)}
                />
                <Tooltip
                  contentStyle={{
                    borderRadius: "8px",
                    border: "1px solid var(--border)",
                    background: "var(--card)",
                  }}
                  formatter={(value: number, name: string) => {
                    if (name === "新增客戶") return [`${value.toLocaleString()} 人`, name];
                    return [`$${value.toLocaleString()}`, name];
                  }}
                />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: "12px" }} />
                <Area
                  yAxisId="left"
                  type="monotone"
                  dataKey="count"
                  name="新增客戶"
                  stroke="#6366f1"
                  fillOpacity={1}
                  fill="url(#colorCount)"
                  strokeWidth={2}
                />
                <Area
                  yAxisId="right"
                  type="monotone"
                  dataKey="totalSpent"
                  name="消費總額"
                  stroke="#22c55e"
                  fillOpacity={1}
                  fill="url(#colorSpent)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[280px] flex items-center justify-center text-muted-foreground">
              暫無數據
            </div>
          )}
        </CardContent>
      </Card>

      {/* Customer Table */}
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <CardTitle className="text-base">
              客戶列表
              {customerData && (
                <span className="text-muted-foreground font-normal ml-2">
                  ({customerData.total.toLocaleString()} 筆，依最後出貨日排序)
                </span>
              )}
            </CardTitle>
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="搜尋客戶名稱、Email、電話..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(0);
                }}
                className="pl-9 h-9"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {customersLoading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : customerData && customerData.items.length > 0 ? (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="text-left py-3 px-2 font-medium">客戶名稱</th>
                      <th className="text-left py-3 px-2 font-medium">Email</th>
                      <th className="text-left py-3 px-2 font-medium">電話</th>
                      <th className="text-center py-3 px-2 font-medium">分類</th>
                      <th className="text-right py-3 px-2 font-medium">訂單數</th>
                      <th className="text-right py-3 px-2 font-medium">消費總額</th>
                      <th className="text-right py-3 px-2 font-medium">回購天數</th>
                      <th className="text-right py-3 px-2 font-medium">最後出貨</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customerData.items.map((cust) => (
                      <tr
                        key={cust.id}
                        className="border-b last:border-0 hover:bg-muted/50 transition-colors"
                      >
                        <td className="py-3 px-2 font-medium">
                          {cust.name || "—"}
                        </td>
                        <td className="py-3 px-2 text-muted-foreground">
                          {cust.email || "—"}
                        </td>
                        <td className="py-3 px-2 text-muted-foreground">
                          {cust.phone || "—"}
                        </td>
                        <td className="py-3 px-2 text-center">
                          {getLifecycleBadge(cust.lifecycle)}
                        </td>
                        <td className="py-3 px-2 text-right">{cust.totalOrders}</td>
                        <td className="py-3 px-2 text-right">
                          ${parseFloat(String(cust.totalSpent)).toLocaleString()}
                        </td>
                        <td className="py-3 px-2 text-right">
                          {cust.avgRepurchaseDays !== null && cust.avgRepurchaseDays !== undefined && cust.avgRepurchaseDays > 0
                            ? `${cust.avgRepurchaseDays} 天`
                            : "—"}
                        </td>
                        <td className="py-3 px-2 text-right text-muted-foreground">
                          {cust.lastShipmentAt
                            ? new Date(cust.lastShipmentAt).toLocaleDateString("zh-TW")
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-4 pt-4 border-t">
                  <p className="text-sm text-muted-foreground">
                    第 {page + 1} / {totalPages} 頁
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page === 0}
                      onClick={() => setPage((p) => p - 1)}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page >= totalPages - 1}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="py-12 text-center text-muted-foreground">
              {search
                ? "找不到符合條件的客戶"
                : "暫無客戶數據，請先同步 CRM 資料"}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
