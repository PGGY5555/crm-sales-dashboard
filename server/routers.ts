import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { z } from "zod";
import {
  getKPISummary,
  getSalesTrend,
  getSalesFunnel,
  getSalesRepPerformance,
  getLifecycleDistribution,
  getCustomerList,
  getLastSyncLog,
  getLLMContextData,
} from "./db";
import { syncFromShopnex } from "./sync";
import { invokeLLM } from "./_core/llm";

const dateRangeSchema = z.object({
  from: z.date().optional(),
  to: z.date().optional(),
}).optional();

const filtersSchema = z.object({
  dateRange: dateRangeSchema,
  lifecycles: z.array(z.string()).optional(),
});

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  dashboard: router({
    /** KPI summary */
    kpi: protectedProcedure
      .input(filtersSchema.optional())
      .query(async ({ input }) => {
        return getKPISummary(input ?? {});
      }),

    /** Sales trend */
    trend: protectedProcedure
      .input(z.object({
        period: z.enum(["day", "week", "month", "quarter"]).default("month"),
        filters: filtersSchema.optional(),
      }).optional())
      .query(async ({ input }) => {
        return getSalesTrend(input?.period ?? "month", input?.filters ?? {});
      }),

    /** Sales funnel */
    funnel: protectedProcedure
      .input(filtersSchema.optional())
      .query(async ({ input }) => {
        return getSalesFunnel(input ?? {});
      }),

    /** Sales rep performance */
    salesReps: protectedProcedure
      .input(filtersSchema.optional())
      .query(async ({ input }) => {
        return getSalesRepPerformance(input ?? {});
      }),

    /** Customer lifecycle distribution */
    lifecycle: protectedProcedure
      .input(filtersSchema.optional())
      .query(async ({ input }) => {
        return getLifecycleDistribution(input ?? {});
      }),

    /** Customer list */
    customers: protectedProcedure
      .input(z.object({
        page: z.number().default(0),
        limit: z.number().default(20),
        search: z.string().optional(),
        lifecycles: z.array(z.string()).optional(),
      }).optional())
      .query(async ({ input }) => {
        return getCustomerList(input ?? {});
      }),

    /** Last sync status */
    syncStatus: protectedProcedure.query(async () => {
      return getLastSyncLog();
    }),
  }),

  /** Sync data from Shopnex CRM */
  sync: router({
    trigger: protectedProcedure
      .input(z.object({
        apiToken: z.string(),
        appName: z.string(),
      }))
      .mutation(async ({ input }) => {
        return syncFromShopnex(input.apiToken, input.appName);
      }),
  }),

  /** AI chat for sales insights */
  ai: router({
    chat: protectedProcedure
      .input(z.object({
        messages: z.array(z.object({
          role: z.enum(["system", "user", "assistant"]),
          content: z.string(),
        })),
        filters: filtersSchema.optional(),
      }))
      .mutation(async ({ input }) => {
        // Get current data context for LLM
        const contextData = await getLLMContextData(input.filters ?? {});

        const systemPrompt = `你是一個專業的銷售數據分析助手。你可以根據以下即時數據回答用戶關於銷售績效、客戶分析的問題。

當前數據摘要：
- 總營收：${contextData.kpi?.totalRevenue?.toLocaleString() ?? "N/A"} 元
- 總訂單數：${contextData.kpi?.totalOrders ?? "N/A"}
- 轉化率：${contextData.kpi?.conversionRate ?? "N/A"}%
- 活躍交易數：${contextData.kpi?.activeDeals ?? "N/A"}
- 月度增長率：${contextData.kpi?.monthlyGrowth ?? "N/A"}%
- 總客戶數：${contextData.kpi?.totalCustomers ?? "N/A"}

客戶生命週期分佈：
${contextData.lifecycle?.map(l => `${l.label}: ${l.count} 人, 總消費 ${l.totalSpent.toLocaleString()} 元`).join("\n") ?? "無數據"}

銷售漏斗：
${contextData.funnel?.map(f => `${f.stage}: ${f.count} 筆 (${f.rate}%)`).join("\n") ?? "無數據"}

業績排行（前5名）：
${contextData.topSalesReps?.map((r, i) => `${i + 1}. ${r.salesRep}: 營收 ${r.revenue.toLocaleString()} 元, ${r.orderCount} 筆訂單`).join("\n") ?? "無數據"}

客戶分類說明：
- N 新鮮客：最後出貨日在半年內，僅買一次
- A 活躍客：最後出貨日在半年內，買一次以上
- S 沉睡客：最後出貨日在一年內但半年內沒買，買一次以上
- L 流失客：最後出貨日在一年內但半年內沒買，僅買一次
- D 封存客：一年內都沒買
- O 機會客：一年內都沒買，但有一年內註冊

請用繁體中文回答，提供具體數據和可行的建議。回答要簡潔專業。`;

        const messages = [
          { role: "system" as const, content: systemPrompt },
          ...input.messages.filter(m => m.role !== "system"),
        ];

        try {
          const response = await invokeLLM({ messages });
          const rawContent = response.choices?.[0]?.message?.content;
          const content = typeof rawContent === "string" ? rawContent : (rawContent ? JSON.stringify(rawContent) : "抱歉，無法生成回應。");
          return { content };
        } catch (error: any) {
          console.error("[AI Chat] Error:", error);
          return { content: "抱歉，AI 服務暫時無法使用。請稍後再試。" };
        }
      }),
  }),
});

export type AppRouter = typeof appRouter;
