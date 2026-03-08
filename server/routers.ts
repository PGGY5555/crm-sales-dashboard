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
  saveSetting,
  getMaskedSetting,
  getCrmCredentials,
  clearAllData,
  getCustomerManagement,
  getCustomerManagementExport,
  getDistinctMemberLevels,
  getOrderManagement,
  getOrderManagementExport,
  getOrderFilterOptions,
  batchDeleteCustomers,
  batchDeleteOrders,
  getCustomerDetail,
  getOrderDetail,
  updateCustomer,
  getAllUsers,
  removeUser,
  getUserPermissions,
  saveUserPermissions,
  checkUserPermission,
  updateUserRole,
  preCreateUser,
  logAudit,
  getAuditLogs,
} from "./db";
import { PERMISSION_KEYS, type PermissionKey } from "../shared/permissions";
import { TRPCError } from "@trpc/server";
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

  /** Admin-only settings for API credentials */
  settings: router({
    /** Get masked credential status (admin only) */
    getCredentials: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "僅管理員可存取此功能" });
      }
      const [apiToken, appName] = await Promise.all([
        getMaskedSetting("shopnex_api_token"),
        getMaskedSetting("shopnex_app_name"),
      ]);
      return { apiToken, appName };
    }),

    /** Save API credentials (admin only) */
    saveCredentials: protectedProcedure
      .input(z.object({
        apiToken: z.string().min(1, "API Token 不可為空"),
        appName: z.string().min(1, "App Name 不可為空"),
      }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "僅管理員可存取此功能" });
        }
        await saveSetting("shopnex_api_token", input.apiToken, ctx.user.id);
        await saveSetting("shopnex_app_name", input.appName, ctx.user.id);
        await logAudit({
          userId: ctx.user.id, userName: ctx.user.name ?? undefined, userEmail: ctx.user.email ?? undefined,
          action: "save_setting", category: "系統設定",
          description: `更新 API 憑證 (App Name: ${input.appName})`,
        });
        return { success: true };
      }),
  }),

  /** Sync data from Shopnex CRM */
  sync: router({
    /** Trigger sync using stored credentials (admin only) */
    trigger: protectedProcedure
      .mutation(async ({ ctx }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "僅管理員可執行同步" });
        }
        const creds = await getCrmCredentials();
        if (!creds) {
          return { success: false, error: "尚未設定 API 憑證，請先在設定頁面儲存 API Token 和 App Name" };
        }
        const result = await syncFromShopnex(creds.apiToken, creds.appName);
        await logAudit({
          userId: ctx.user.id, userName: ctx.user.name ?? undefined, userEmail: ctx.user.email ?? undefined,
          action: "sync_api", category: "數據同步",
          description: `執行 API 同步 (${result.success ? '成功' : '失敗'})`,
          details: result,
        });
        return result;
      }),

    /** Clear all imported data (admin only) */
    clearData: protectedProcedure
      .input(z.object({
        targets: z.array(z.enum(["customers", "orders", "products", "all"])).min(1),
      }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "僅管理員可清除資料" });
        }
        const result = await clearAllData(input.targets);
        await logAudit({
          userId: ctx.user.id, userName: ctx.user.name ?? undefined, userEmail: ctx.user.email ?? undefined,
          action: "clear_data", category: "資料刪除",
          description: `清除資料: ${input.targets.join(', ')}`,
          details: { targets: input.targets },
        });
        return result;
      }),
  }),

  /** Customer management with advanced filters */
  customerMgmt: router({
    list: protectedProcedure
      .input(z.object({
        searchField: z.enum(["customerName", "customerPhone", "customerEmail", "recipientName", "recipientPhone", "recipientEmail"]).optional(),
        searchValue: z.string().optional(),
        registeredFrom: z.date().optional(),
        registeredTo: z.date().optional(),
        birthdayMonth: z.number().min(1).max(12).optional(),
        tags: z.string().optional(),
        memberLevel: z.string().optional(),
        creditsOp: z.enum(["lt", "gt", "eq"]).optional(),
        creditsValue: z.number().optional(),
        totalSpentOp: z.enum(["lt", "gt", "eq"]).optional(),
        totalSpentValue: z.number().optional(),
        totalOrdersOp: z.enum(["lt", "gt", "eq"]).optional(),
        totalOrdersValue: z.number().optional(),
        lastPurchaseFrom: z.date().optional(),
        lastPurchaseTo: z.date().optional(),
        lastPurchaseAmountOp: z.enum(["lt", "gt", "eq"]).optional(),
        lastPurchaseAmountValue: z.number().optional(),
        lastShipmentFrom: z.date().optional(),
        lastShipmentTo: z.date().optional(),
        lifecycles: z.array(z.string()).optional(),
        blacklisted: z.string().optional(),
        lineUid: z.string().optional(),
        page: z.number().default(0),
        limit: z.number().default(50),
      }).optional())
      .query(async ({ input }) => {
        return getCustomerManagement(input ?? {});
      }),

    export: protectedProcedure
      .input(z.object({
        searchField: z.enum(["customerName", "customerPhone", "customerEmail", "recipientName", "recipientPhone", "recipientEmail"]).optional(),
        searchValue: z.string().optional(),
        registeredFrom: z.date().optional(),
        registeredTo: z.date().optional(),
        birthdayMonth: z.number().min(1).max(12).optional(),
        tags: z.string().optional(),
        memberLevel: z.string().optional(),
        creditsOp: z.enum(["lt", "gt", "eq"]).optional(),
        creditsValue: z.number().optional(),
        totalSpentOp: z.enum(["lt", "gt", "eq"]).optional(),
        totalSpentValue: z.number().optional(),
        totalOrdersOp: z.enum(["lt", "gt", "eq"]).optional(),
        totalOrdersValue: z.number().optional(),
        lastPurchaseFrom: z.date().optional(),
        lastPurchaseTo: z.date().optional(),
        lastPurchaseAmountOp: z.enum(["lt", "gt", "eq"]).optional(),
        lastPurchaseAmountValue: z.number().optional(),
        lastShipmentFrom: z.date().optional(),
        lastShipmentTo: z.date().optional(),
        lifecycles: z.array(z.string()).optional(),
        blacklisted: z.string().optional(),
        lineUid: z.string().optional(),
      }).optional())
      .query(async ({ input }) => {
        return getCustomerManagementExport(input ?? {});
      }),

    memberLevels: protectedProcedure.query(async () => {
      return getDistinctMemberLevels();
    }),

    batchDelete: protectedProcedure
      .input(z.object({ ids: z.array(z.number()).min(1) }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "僅管理員可刪除資料" });
        }
        const result = await batchDeleteCustomers(input.ids);
        await logAudit({
          userId: ctx.user.id, userName: ctx.user.name ?? undefined, userEmail: ctx.user.email ?? undefined,
          action: "delete_customers", category: "資料刪除",
          description: `批次刪除 ${input.ids.length} 筆客戶資料`,
          details: { count: input.ids.length, ids: input.ids },
        });
        return result;
      }),

    detail: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const result = await getCustomerDetail(input.id);
        if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "找不到該客戶" });
        return result;
      }),

    update: protectedProcedure
      .input(z.object({
        id: z.number(),
        name: z.string().nullable().optional(),
        email: z.string().nullable().optional(),
        phone: z.string().nullable().optional(),
        birthday: z.string().nullable().optional(),
        tags: z.string().nullable().optional(),
        memberLevel: z.string().nullable().optional(),
        credits: z.string().nullable().optional(),
        recipientName: z.string().nullable().optional(),
        recipientPhone: z.string().nullable().optional(),
        recipientEmail: z.string().nullable().optional(),
        notes: z.string().nullable().optional(),
        note1: z.string().nullable().optional(),
        note2: z.string().nullable().optional(),
        custom1: z.string().nullable().optional(),
        custom2: z.string().nullable().optional(),
        custom3: z.string().nullable().optional(),
        blacklisted: z.string().nullable().optional(),
        lineUid: z.string().nullable().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { id, ...data } = input;
        // Filter out undefined fields
        const updateData: Record<string, any> = {};
        for (const [key, value] of Object.entries(data)) {
          if (value !== undefined) updateData[key] = value;
        }
        const result = await updateCustomer(id, updateData);
        if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "找不到該客戶" });
        await logAudit({
          userId: ctx.user.id, userName: ctx.user.name ?? undefined, userEmail: ctx.user.email ?? undefined,
          action: "update_customer", category: "客戶管理",
          description: `更新客戶資料 #${id}`,
          details: { customerId: id, updatedFields: Object.keys(updateData) },
        });
        return result;
      }),
  }),

  /** Order management with advanced filters */
  orderMgmt: router({
    list: protectedProcedure
      .input(z.object({
        searchField: z.enum(["orderNumber", "customerName", "customerPhone", "customerEmail", "recipientName", "recipientPhone", "recipientEmail", "deliveryNumber"]).optional(),
        searchValue: z.string().optional(),
        orderSource: z.string().optional(),
        paymentMethod: z.string().optional(),
        shippingMethod: z.string().optional(),
        shippingAddress: z.string().optional(),
        shippedFrom: z.date().optional(),
        shippedTo: z.date().optional(),
        logisticsStatus: z.string().optional(),
        page: z.number().default(0),
        limit: z.number().default(50),
      }).optional())
      .query(async ({ input }) => {
        return getOrderManagement(input ?? {});
      }),

    export: protectedProcedure
      .input(z.object({
        searchField: z.enum(["orderNumber", "customerName", "customerPhone", "customerEmail", "recipientName", "recipientPhone", "recipientEmail", "deliveryNumber"]).optional(),
        searchValue: z.string().optional(),
        orderSource: z.string().optional(),
        paymentMethod: z.string().optional(),
        shippingMethod: z.string().optional(),
        shippingAddress: z.string().optional(),
        shippedFrom: z.date().optional(),
        shippedTo: z.date().optional(),
        logisticsStatus: z.string().optional(),
      }).optional())
      .query(async ({ input }) => {
        return getOrderManagementExport(input ?? {});
      }),

    filterOptions: protectedProcedure.query(async () => {
      return getOrderFilterOptions();
    }),

    detail: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        return getOrderDetail(input.id);
      }),

    batchDelete: protectedProcedure
      .input(z.object({ ids: z.array(z.number()).min(1) }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "僅管理員可刪除資料" });
        }
        const result = await batchDeleteOrders(input.ids);
        await logAudit({
          userId: ctx.user.id, userName: ctx.user.name ?? undefined, userEmail: ctx.user.email ?? undefined,
          action: "delete_orders", category: "資料刪除",
          description: `批次刪除 ${input.ids.length} 筆訂單資料`,
          details: { count: input.ids.length, ids: input.ids },
        });
        return result;
      }),
  }),

  /** User management (admin only) */
  userMgmt: router({
    /** List all users */
    list: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "僅管理員可存取此功能" });
      }
      return getAllUsers();
    }),

    /** Remove a user */
    remove: protectedProcedure
      .input(z.object({ userId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "僅管理員可存取此功能" });
        }
        if (input.userId === ctx.user.id) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "無法移除自己的帳號" });
        }
        const result = await removeUser(input.userId);
        await logAudit({
          userId: ctx.user.id, userName: ctx.user.name ?? undefined, userEmail: ctx.user.email ?? undefined,
          action: "remove_user", category: "使用者管理",
          description: `移除使用者 #${input.userId}`,
          details: { targetUserId: input.userId },
        });
        return result;
      }),

    /** Update user role */
    updateRole: protectedProcedure
      .input(z.object({ userId: z.number(), role: z.enum(["user", "admin"]) }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "僅管理員可存取此功能" });
        }
        if (input.userId === ctx.user.id) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "無法修改自己的角色" });
        }
        const result = await updateUserRole(input.userId, input.role);
        await logAudit({
          userId: ctx.user.id, userName: ctx.user.name ?? undefined, userEmail: ctx.user.email ?? undefined,
          action: "update_role", category: "使用者管理",
          description: `更新使用者 #${input.userId} 角色為 ${input.role}`,
          details: { targetUserId: input.userId, newRole: input.role },
        });
        return result;
      }),

    /** Get permissions for a user */
    getPermissions: protectedProcedure
      .input(z.object({ userId: z.number() }))
      .query(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "僅管理員可存取此功能" });
        }
        return getUserPermissions(input.userId);
      }),

    /** Save permissions for a user */
    savePermissions: protectedProcedure
      .input(z.object({
        userId: z.number(),
        permissions: z.record(z.string(), z.boolean()),
      }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "僅管理員可存取此功能" });
        }
        const result = await saveUserPermissions(input.userId, input.permissions, ctx.user.id);
        const enabledPerms = Object.entries(input.permissions).filter(([, v]) => v).map(([k]) => k);
        await logAudit({
          userId: ctx.user.id, userName: ctx.user.name ?? undefined, userEmail: ctx.user.email ?? undefined,
          action: "update_permissions", category: "使用者管理",
          description: `更新使用者 #${input.userId} 權限 (${enabledPerms.length} 項已啟用)`,
          details: { targetUserId: input.userId, enabledPermissions: enabledPerms },
        });
        return result;
      }),

    /** Get my permissions (for current logged-in user) */
    myPermissions: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role === "admin") {
        const allPerms: Record<string, boolean> = {};
        for (const key of PERMISSION_KEYS) allPerms[key] = true;
        return allPerms;
      }
      return getUserPermissions(ctx.user.id);
    }),

    /** Pre-create a user by email */
    preCreate: protectedProcedure
      .input(z.object({
        email: z.string().email(),
        role: z.enum(["user", "admin"]),
      }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "僅管理員可新增使用者" });
        }
        const newUser = await preCreateUser(input.email, input.role, ctx.user.id);
        await logAudit({
          userId: ctx.user.id,
          userName: ctx.user.name ?? undefined,
          userEmail: ctx.user.email ?? undefined,
          action: "create_user",
          category: "使用者管理",
          description: `新增使用者: ${input.email} (角色: ${input.role})`,
          details: { targetEmail: input.email, role: input.role },
        });
        return newUser;
      }),
  }),

  /** Audit logs */
  auditLog: router({
    list: protectedProcedure
      .input(z.object({
        page: z.number().optional(),
        pageSize: z.number().optional(),
        category: z.string().optional(),
        action: z.string().optional(),
        userId: z.number().optional(),
        dateFrom: z.date().optional(),
        dateTo: z.date().optional(),
        search: z.string().optional(),
      }))
      .query(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "僅管理員可查看操作日誌" });
        }
        return getAuditLogs(input);
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
