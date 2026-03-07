import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DollarSign,
  ShoppingCart,
  TrendingUp,
  Users,
  Zap,
  Package,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

const LIFECYCLE_COLORS: Record<string, string> = {
  N: "#6366f1",
  A: "#22c55e",
  S: "#f59e0b",
  L: "#ef4444",
  D: "#6b7280",
  O: "#06b6d4",
};

function KPICard({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
  loading,
}: {
  title: string;
  value: string;
  subtitle?: string;
  icon: any;
  trend?: number;
  loading?: boolean;
}) {
  if (loading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-10 w-10 rounded-lg" />
          </div>
          <Skeleton className="h-8 w-32 mt-3" />
          <Skeleton className="h-3 w-20 mt-2" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Icon className="h-5 w-5 text-primary" />
          </div>
        </div>
        <div className="mt-3">
          <p className="text-2xl font-bold tracking-tight">{value}</p>
          {(subtitle || trend !== undefined) && (
            <div className="flex items-center gap-1 mt-1">
              {trend !== undefined && (
                <span
                  className={`flex items-center text-xs font-medium ${
                    trend >= 0 ? "text-green-600" : "text-red-500"
                  }`}
                >
                  {trend >= 0 ? (
                    <ArrowUpRight className="h-3 w-3" />
                  ) : (
                    <ArrowDownRight className="h-3 w-3" />
                  )}
                  {Math.abs(trend)}%
                </span>
              )}
              {subtitle && (
                <span className="text-xs text-muted-foreground">{subtitle}</span>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function Home() {
  const { data: kpi, isLoading: kpiLoading } = trpc.dashboard.kpi.useQuery(undefined);
  const { data: salesReps, isLoading: repsLoading } = trpc.dashboard.salesReps.useQuery(undefined);
  const { data: lifecycle, isLoading: lifecycleLoading } = trpc.dashboard.lifecycle.useQuery(undefined);
  const { data: trend, isLoading: trendLoading } = trpc.dashboard.trend.useQuery({
    period: "month",
  });

  const formatCurrency = (val: number) => {
    if (val >= 1000000) return `$${(val / 1000000).toFixed(1)}M`;
    if (val >= 1000) return `$${(val / 1000).toFixed(1)}K`;
    return `$${val.toFixed(0)}`;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">儀表板總覽</h1>
        <p className="text-muted-foreground mt-1">
          即時銷售數據與客戶分析概覽
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <KPICard
          title="總營收"
          value={kpi ? formatCurrency(kpi.totalRevenue) : "$0"}
          icon={DollarSign}
          trend={kpi?.monthlyGrowth}
          subtitle="月度增長"
          loading={kpiLoading}
        />
        <KPICard
          title="總訂單數"
          value={kpi?.totalOrders?.toLocaleString() ?? "0"}
          icon={ShoppingCart}
          loading={kpiLoading}
        />
        <KPICard
          title="轉化率"
          value={`${kpi?.conversionRate ?? 0}%`}
          icon={TrendingUp}
          loading={kpiLoading}
        />
        <KPICard
          title="活躍交易"
          value={kpi?.activeDeals?.toLocaleString() ?? "0"}
          icon={Zap}
          loading={kpiLoading}
        />
        <KPICard
          title="已出貨"
          value={kpi?.shippedOrders?.toLocaleString() ?? "0"}
          icon={Package}
          loading={kpiLoading}
        />
        <KPICard
          title="客戶總數"
          value={kpi?.totalCustomers?.toLocaleString() ?? "0"}
          icon={Users}
          loading={kpiLoading}
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Monthly Revenue Trend */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">月度營收趨勢</CardTitle>
          </CardHeader>
          <CardContent>
            {trendLoading ? (
              <Skeleton className="h-[300px] w-full" />
            ) : trend && trend.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={trend}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis dataKey="period" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => formatCurrency(v)} />
                  <Tooltip
                    formatter={(value: number) => [`$${value.toLocaleString()}`, "營收"]}
                    contentStyle={{
                      borderRadius: "8px",
                      border: "1px solid var(--border)",
                      background: "var(--card)",
                    }}
                  />
                  <Bar dataKey="revenue" fill="var(--color-chart-1)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                暫無趨勢數據，請先同步 CRM 資料
              </div>
            )}
          </CardContent>
        </Card>

        {/* Lifecycle Distribution */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">客戶生命週期分佈</CardTitle>
          </CardHeader>
          <CardContent>
            {lifecycleLoading ? (
              <Skeleton className="h-[300px] w-full" />
            ) : lifecycle && lifecycle.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
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
                    {lifecycle.map((entry) => (
                      <Cell
                        key={entry.lifecycle}
                        fill={LIFECYCLE_COLORS[entry.lifecycle] || "#6b7280"}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value: number, name: string) => [
                      `${value} 人`,
                      name,
                    ]}
                    contentStyle={{
                      borderRadius: "8px",
                      border: "1px solid var(--border)",
                      background: "var(--card)",
                    }}
                  />
                  <Legend
                    verticalAlign="bottom"
                    height={36}
                    iconType="circle"
                    iconSize={8}
                    wrapperStyle={{ fontSize: "12px" }}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                暫無客戶數據
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Sales Rep Performance */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">業務員績效排行</CardTitle>
        </CardHeader>
        <CardContent>
          {repsLoading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : salesReps && salesReps.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left py-3 px-2 font-medium">排名</th>
                    <th className="text-left py-3 px-2 font-medium">業務員</th>
                    <th className="text-right py-3 px-2 font-medium">營收</th>
                    <th className="text-right py-3 px-2 font-medium">訂單數</th>
                    <th className="text-right py-3 px-2 font-medium">出貨數</th>
                    <th className="text-right py-3 px-2 font-medium">轉化率</th>
                  </tr>
                </thead>
                <tbody>
                  {salesReps.map((rep, i) => (
                    <tr key={rep.salesRep} className="border-b last:border-0 hover:bg-muted/50 transition-colors">
                      <td className="py-3 px-2">
                        <span
                          className={`inline-flex items-center justify-center h-6 w-6 rounded-full text-xs font-bold ${
                            i < 3
                              ? "bg-primary/10 text-primary"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {i + 1}
                        </span>
                      </td>
                      <td className="py-3 px-2 font-medium">{rep.salesRep}</td>
                      <td className="py-3 px-2 text-right">${rep.revenue.toLocaleString()}</td>
                      <td className="py-3 px-2 text-right">{rep.orderCount}</td>
                      <td className="py-3 px-2 text-right">{rep.shippedCount}</td>
                      <td className="py-3 px-2 text-right">
                        <span
                          className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                            rep.conversionRate >= 70
                              ? "bg-green-100 text-green-700"
                              : rep.conversionRate >= 40
                              ? "bg-yellow-100 text-yellow-700"
                              : "bg-red-100 text-red-700"
                          }`}
                        >
                          {rep.conversionRate}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="py-12 text-center text-muted-foreground">
              暫無業務員數據，請先同步 CRM 資料
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
