import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useState, useMemo } from "react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  Area,
  AreaChart,
} from "recharts";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import { zhTW } from "date-fns/locale";

type Period = "day" | "week" | "month" | "quarter";

const periodLabels: Record<Period, string> = {
  day: "日",
  week: "週",
  month: "月",
  quarter: "季",
};

export default function Trends() {
  const [period, setPeriod] = useState<Period>("month");
  const [dateFrom, setDateFrom] = useState<Date | undefined>(undefined);
  const [dateTo, setDateTo] = useState<Date | undefined>(undefined);

  const filters = useMemo(() => ({
    period,
    filters: {
      dateRange: {
        from: dateFrom,
        to: dateTo,
      },
    },
  }), [period, dateFrom, dateTo]);

  const { data: trend, isLoading } = trpc.dashboard.trend.useQuery(filters);

  const formatCurrency = (val: number) => {
    if (val >= 1000000) return `$${(val / 1000000).toFixed(1)}M`;
    if (val >= 1000) return `$${(val / 1000).toFixed(1)}K`;
    return `$${val.toFixed(0)}`;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">銷售趨勢</h1>
        <p className="text-muted-foreground mt-1">
          追蹤不同時段的銷售表現與訂單量變化
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex gap-1 bg-muted p-1 rounded-lg">
          {(Object.keys(periodLabels) as Period[]).map((p) => (
            <Button
              key={p}
              variant={period === p ? "default" : "ghost"}
              size="sm"
              onClick={() => setPeriod(p)}
              className="h-8 px-3"
            >
              {periodLabels[p]}
            </Button>
          ))}
        </div>

        <div className="flex gap-2 items-center">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-2">
                <CalendarIcon className="h-3.5 w-3.5" />
                {dateFrom ? format(dateFrom, "yyyy/MM/dd") : "開始日期"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={dateFrom}
                onSelect={setDateFrom}
                locale={zhTW}
              />
            </PopoverContent>
          </Popover>
          <span className="text-muted-foreground text-sm">至</span>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-2">
                <CalendarIcon className="h-3.5 w-3.5" />
                {dateTo ? format(dateTo, "yyyy/MM/dd") : "結束日期"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={dateTo}
                onSelect={setDateTo}
                locale={zhTW}
              />
            </PopoverContent>
          </Popover>
          {(dateFrom || dateTo) && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8"
              onClick={() => {
                setDateFrom(undefined);
                setDateTo(undefined);
              }}
            >
              清除
            </Button>
          )}
        </div>
      </div>

      {/* Revenue Area Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">營收趨勢</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-[350px] w-full" />
          ) : trend && trend.length > 0 ? (
            <ResponsiveContainer width="100%" height={350}>
              <AreaChart data={trend}>
                <defs>
                  <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--color-chart-1)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="var(--color-chart-1)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                <XAxis dataKey="period" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} tickFormatter={formatCurrency} />
                <Tooltip
                  formatter={(value: number, name: string) => [
                    `$${value.toLocaleString()}`,
                    name === "revenue" ? "營收" : name,
                  ]}
                  contentStyle={{
                    borderRadius: "8px",
                    border: "1px solid var(--border)",
                    background: "var(--card)",
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="revenue"
                  stroke="var(--color-chart-1)"
                  fill="url(#revenueGradient)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[350px] flex items-center justify-center text-muted-foreground">
              暫無趨勢數據，請先同步 CRM 資料
            </div>
          )}
        </CardContent>
      </Card>

      {/* Order Count Bar Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">訂單量趨勢</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-[300px] w-full" />
          ) : trend && trend.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={trend}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                <XAxis dataKey="period" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip
                  formatter={(value: number) => [`${value} 筆`, "訂單數"]}
                  contentStyle={{
                    borderRadius: "8px",
                    border: "1px solid var(--border)",
                    background: "var(--card)",
                  }}
                />
                <Bar dataKey="orderCount" fill="var(--color-chart-2)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[300px] flex items-center justify-center text-muted-foreground">
              暫無訂單數據
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
