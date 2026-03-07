import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const FUNNEL_COLORS = ["#6366f1", "#818cf8", "#a5b4fc", "#c7d2fe"];

export default function Funnel() {
  const { data: funnel, isLoading } = trpc.dashboard.funnel.useQuery(undefined);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">銷售漏斗</h1>
        <p className="text-muted-foreground mt-1">
          追蹤從潛在訂單到成交的各個階段轉化率
        </p>
      </div>

      {isLoading ? (
        <Card>
          <CardContent className="p-8">
            <Skeleton className="h-[400px] w-full" />
          </CardContent>
        </Card>
      ) : funnel && funnel.length > 0 ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Visual Funnel */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">轉化漏斗</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3 py-4">
                {funnel.map((stage, i) => {
                  const widthPercent = Math.max(
                    20,
                    stage.rate
                  );
                  return (
                    <div key={stage.stage} className="flex items-center gap-4">
                      <div className="w-20 text-sm font-medium text-right shrink-0">
                        {stage.stage}
                      </div>
                      <div className="flex-1 relative">
                        <div
                          className="h-12 rounded-lg flex items-center justify-center transition-all duration-500"
                          style={{
                            width: `${widthPercent}%`,
                            backgroundColor: FUNNEL_COLORS[i] || FUNNEL_COLORS[0],
                          }}
                        >
                          <span className="text-white text-sm font-bold">
                            {stage.count}
                          </span>
                        </div>
                      </div>
                      <div className="w-14 text-sm font-medium text-right shrink-0">
                        {stage.rate}%
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Conversion Details */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">階段轉化詳情</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-6 py-4">
                {funnel.map((stage, i) => {
                  const prevCount = i > 0 ? funnel[i - 1].count : stage.count;
                  const stepRate =
                    prevCount > 0
                      ? Math.round((stage.count / prevCount) * 100)
                      : 100;
                  return (
                    <div key={stage.stage}>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <div
                            className="w-3 h-3 rounded-full"
                            style={{
                              backgroundColor: FUNNEL_COLORS[i] || FUNNEL_COLORS[0],
                            }}
                          />
                          <span className="font-medium text-sm">{stage.stage}</span>
                        </div>
                        <div className="text-right">
                          <span className="text-lg font-bold">{stage.count}</span>
                          <span className="text-muted-foreground text-sm ml-2">
                            ({stage.rate}%)
                          </span>
                        </div>
                      </div>
                      {i > 0 && (
                        <div className="ml-5 pl-3 border-l-2 border-muted">
                          <p className="text-xs text-muted-foreground">
                            從「{funnel[i - 1].stage}」到「{stage.stage}」的轉化率：
                            <span
                              className={`font-bold ml-1 ${
                                stepRate >= 70
                                  ? "text-green-600"
                                  : stepRate >= 40
                                  ? "text-yellow-600"
                                  : "text-red-500"
                              }`}
                            >
                              {stepRate}%
                            </span>
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>
      ) : (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            暫無漏斗數據，請先同步 CRM 資料
          </CardContent>
        </Card>
      )}
    </div>
  );
}
