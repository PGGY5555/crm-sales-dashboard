import { eq, and, gte, lte, sql, inArray, desc, asc, between, like, or, count } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, users, customers, orders, syncLogs, settings } from "../drizzle/schema";
import { encrypt, decrypt, maskToken } from "./crypto";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// ===== Dashboard Query Helpers =====

export interface DateRange {
  from?: Date;
  to?: Date;
}

export interface DashboardFilters {
  dateRange?: DateRange;
  lifecycles?: string[];
}

function buildOrderConditions(filters: DashboardFilters) {
  const conditions: any[] = [];
  if (filters.dateRange?.from) {
    conditions.push(gte(orders.orderDate, filters.dateRange.from));
  }
  if (filters.dateRange?.to) {
    conditions.push(lte(orders.orderDate, filters.dateRange.to));
  }
  // Exclude cancelled orders
  conditions.push(sql`${orders.orderStatus} != -1`);
  return conditions.length > 0 ? and(...conditions) : undefined;
}

/** Get KPI summary */
export async function getKPISummary(filters: DashboardFilters = {}) {
  const db = await getDb();
  if (!db) return null;

  const where = buildOrderConditions(filters);

  // Total revenue
  const [revenueResult] = await db
    .select({ total: sql<string>`COALESCE(SUM(${orders.total}), 0)` })
    .from(orders)
    .where(where);

  // Total orders
  const [orderCountResult] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(orders)
    .where(where);

  // Shipped orders (completed)
  const shippedWhere = where
    ? and(where, eq(orders.isShipped, true))
    : eq(orders.isShipped, true);
  const [shippedResult] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(orders)
    .where(shippedWhere);

  // Active deals (not shipped, not cancelled)
  const activeWhere = where
    ? and(where, eq(orders.isShipped, false))
    : and(eq(orders.isShipped, false), sql`${orders.orderStatus} != -1`);
  const [activeResult] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(orders)
    .where(activeWhere);

  // Customer count
  let customerWhere: any = undefined;
  if (filters.lifecycles && filters.lifecycles.length > 0) {
    customerWhere = inArray(customers.lifecycle, filters.lifecycles as any);
  }
  const [customerCountResult] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(customers)
    .where(customerWhere);

  // Previous period for growth rate
  const totalRevenue = parseFloat(revenueResult?.total || "0");
  const totalOrderCount = Number(orderCountResult?.count || 0);
  const shippedCount = Number(shippedResult?.count || 0);
  const conversionRate = totalOrderCount > 0 ? (shippedCount / totalOrderCount) * 100 : 0;

  // Monthly growth: compare current month vs previous month
  const now = new Date();
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

  const [thisMonthRev] = await db
    .select({ total: sql<string>`COALESCE(SUM(${orders.total}), 0)` })
    .from(orders)
    .where(and(gte(orders.orderDate, thisMonthStart), sql`${orders.orderStatus} != -1`));

  const [lastMonthRev] = await db
    .select({ total: sql<string>`COALESCE(SUM(${orders.total}), 0)` })
    .from(orders)
    .where(and(
      gte(orders.orderDate, lastMonthStart),
      lte(orders.orderDate, lastMonthEnd),
      sql`${orders.orderStatus} != -1`
    ));

  const thisMonthTotal = parseFloat(thisMonthRev?.total || "0");
  const lastMonthTotal = parseFloat(lastMonthRev?.total || "0");
  const monthlyGrowth = lastMonthTotal > 0
    ? ((thisMonthTotal - lastMonthTotal) / lastMonthTotal) * 100
    : 0;

  return {
    totalRevenue,
    totalOrders: totalOrderCount,
    activeDeals: Number(activeResult?.count || 0),
    conversionRate: Math.round(conversionRate * 10) / 10,
    monthlyGrowth: Math.round(monthlyGrowth * 10) / 10,
    totalCustomers: Number(customerCountResult?.count || 0),
    shippedOrders: shippedCount,
  };
}

/** Get sales trend data grouped by period */
export async function getSalesTrend(
  period: "day" | "week" | "month" | "quarter" = "month",
  filters: DashboardFilters = {}
) {
  const db = await getDb();
  if (!db) return [];

  let dateFormat: string;
  switch (period) {
    case "day":
      dateFormat = "%Y-%m-%d";
      break;
    case "week":
      dateFormat = "%x-W%v";
      break;
    case "month":
      dateFormat = "%Y-%m";
      break;
    case "quarter":
      dateFormat = "%Y-Q";
      break;
  }

  const where = buildOrderConditions(filters);

  if (period === "quarter") {
    const result = await db
      .select({
        period: sql<string>`CONCAT(YEAR(${orders.orderDate}), '-Q', QUARTER(${orders.orderDate}))`,
        revenue: sql<string>`COALESCE(SUM(${orders.total}), 0)`,
        orderCount: sql<number>`COUNT(*)`,
      })
      .from(orders)
      .where(where)
      .groupBy(sql`CONCAT(YEAR(${orders.orderDate}), '-Q', QUARTER(${orders.orderDate}))`)
      .orderBy(sql`CONCAT(YEAR(${orders.orderDate}), '-Q', QUARTER(${orders.orderDate}))`);
    return result.map(r => ({
      period: r.period,
      revenue: parseFloat(r.revenue),
      orderCount: Number(r.orderCount),
    }));
  }

  const result = await db
    .select({
      period: sql<string>`DATE_FORMAT(${orders.orderDate}, ${dateFormat})`,
      revenue: sql<string>`COALESCE(SUM(${orders.total}), 0)`,
      orderCount: sql<number>`COUNT(*)`,
    })
    .from(orders)
    .where(where)
    .groupBy(sql`DATE_FORMAT(${orders.orderDate}, ${dateFormat})`)
    .orderBy(sql`DATE_FORMAT(${orders.orderDate}, ${dateFormat})`);

  return result.map(r => ({
    period: r.period,
    revenue: parseFloat(r.revenue),
    orderCount: Number(r.orderCount),
  }));
}

/** Get sales funnel data */
export async function getSalesFunnel(filters: DashboardFilters = {}) {
  const db = await getDb();
  if (!db) return [];

  const where = buildOrderConditions(filters);

  // Total orders
  const [totalResult] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(orders)
    .where(where);

  // Confirmed orders (status >= 1)
  const confirmedWhere = where
    ? and(where, sql`${orders.orderStatus} >= 1`)
    : sql`${orders.orderStatus} >= 1`;
  const [confirmedResult] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(orders)
    .where(confirmedWhere);

  // Shipped orders
  const shippedWhere = where
    ? and(where, eq(orders.isShipped, true))
    : eq(orders.isShipped, true);
  const [shippedResult] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(orders)
    .where(shippedWhere);

  // Completed orders (status = 2)
  const completedWhere = where
    ? and(where, sql`${orders.orderStatus} = 2`)
    : sql`${orders.orderStatus} = 2`;
  const [completedResult] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(orders)
    .where(completedWhere);

  const total = Number(totalResult?.count || 0);

  return [
    { stage: "潛在訂單", count: total, rate: 100 },
    { stage: "已確認", count: Number(confirmedResult?.count || 0), rate: total > 0 ? Math.round((Number(confirmedResult?.count || 0) / total) * 100) : 0 },
    { stage: "已出貨", count: Number(shippedResult?.count || 0), rate: total > 0 ? Math.round((Number(shippedResult?.count || 0) / total) * 100) : 0 },
    { stage: "已完成", count: Number(completedResult?.count || 0), rate: total > 0 ? Math.round((Number(completedResult?.count || 0) / total) * 100) : 0 },
  ];
}

/** Get sales rep performance */
export async function getSalesRepPerformance(filters: DashboardFilters = {}) {
  const db = await getDb();
  if (!db) return [];

  const where = buildOrderConditions(filters);

  const result = await db
    .select({
      salesRep: orders.salesRep,
      revenue: sql<string>`COALESCE(SUM(${orders.total}), 0)`,
      orderCount: sql<number>`COUNT(*)`,
      shippedCount: sql<number>`SUM(CASE WHEN ${orders.isShipped} = true THEN 1 ELSE 0 END)`,
    })
    .from(orders)
    .where(where)
    .groupBy(orders.salesRep)
    .orderBy(sql`SUM(${orders.total}) DESC`)
    .limit(20);

  return result.map(r => ({
    salesRep: r.salesRep || "未指定",
    revenue: parseFloat(r.revenue),
    orderCount: Number(r.orderCount),
    shippedCount: Number(r.shippedCount),
    conversionRate: Number(r.orderCount) > 0
      ? Math.round((Number(r.shippedCount) / Number(r.orderCount)) * 100)
      : 0,
  }));
}

/** Get customer lifecycle distribution */
export async function getLifecycleDistribution(filters: DashboardFilters = {}) {
  const db = await getDb();
  if (!db) return [];

  let where: any = undefined;
  if (filters.lifecycles && filters.lifecycles.length > 0) {
    where = inArray(customers.lifecycle, filters.lifecycles as any);
  }

  const result = await db
    .select({
      lifecycle: customers.lifecycle,
      count: sql<number>`COUNT(*)`,
      totalSpent: sql<string>`COALESCE(SUM(${customers.totalSpent}), 0)`,
    })
    .from(customers)
    .where(where)
    .groupBy(customers.lifecycle);

  const labels: Record<string, string> = {
    N: "N 新鮮客",
    A: "A 活躍客",
    S: "S 沉睡客",
    L: "L 流失客",
    D: "D 封存客",
    O: "O 機會客",
  };

  return result.map(r => ({
    lifecycle: r.lifecycle || "O",
    label: labels[r.lifecycle || "O"] || r.lifecycle,
    count: Number(r.count),
    totalSpent: parseFloat(r.totalSpent),
  }));
}

/** Get customer list with lifecycle and repurchase info */
export async function getCustomerList(filters: DashboardFilters & {
  page?: number;
  limit?: number;
  search?: string;
} = {}) {
  const db = await getDb();
  if (!db) return { items: [], total: 0 };

  const conditions: any[] = [];
  if (filters.lifecycles && filters.lifecycles.length > 0) {
    conditions.push(inArray(customers.lifecycle, filters.lifecycles as any));
  }
  if (filters.search) {
    conditions.push(
      or(
        like(customers.name, `%${filters.search}%`),
        like(customers.email, `%${filters.search}%`),
        like(customers.phone, `%${filters.search}%`)
      )
    );
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const page = filters.page ?? 0;
  const limit = filters.limit ?? 20;

  const [countResult] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(customers)
    .where(where);

  const items = await db
    .select()
    .from(customers)
    .where(where)
    .orderBy(desc(customers.totalSpent))
    .limit(limit)
    .offset(page * limit);

  return {
    items,
    total: Number(countResult?.count || 0),
  };
}

/** Get last sync log */
export async function getLastSyncLog() {
  const db = await getDb();
  if (!db) return null;

  const result = await db
    .select()
    .from(syncLogs)
    .orderBy(desc(syncLogs.startedAt))
    .limit(1);

  return result.length > 0 ? result[0] : null;
}

// ===== Settings (Encrypted API Credentials) =====

/** Save an encrypted setting */
export async function saveSetting(key: string, plainValue: string, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const { encrypted, iv } = encrypt(plainValue);

  await db.insert(settings).values({
    key,
    value: encrypted,
    iv,
    updatedBy: userId,
  }).onDuplicateKeyUpdate({
    set: {
      value: encrypted,
      iv,
      updatedBy: userId,
    },
  });
}

/** Get a decrypted setting value */
export async function getSettingValue(key: string): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;

  const result = await db.select().from(settings).where(eq(settings.key, key)).limit(1);
  if (result.length === 0) return null;

  try {
    return decrypt(result[0].value, result[0].iv);
  } catch {
    console.error(`[Settings] Failed to decrypt key: ${key}`);
    return null;
  }
}

/** Get a masked setting value for display */
export async function getMaskedSetting(key: string): Promise<{ exists: boolean; masked: string | null; updatedAt: Date | null }> {
  const db = await getDb();
  if (!db) return { exists: false, masked: null, updatedAt: null };

  const result = await db.select().from(settings).where(eq(settings.key, key)).limit(1);
  if (result.length === 0) return { exists: false, masked: null, updatedAt: null };

  try {
    const plainValue = decrypt(result[0].value, result[0].iv);
    return {
      exists: true,
      masked: maskToken(plainValue),
      updatedAt: result[0].updatedAt,
    };
  } catch {
    return { exists: true, masked: "****", updatedAt: result[0].updatedAt };
  }
}

/** Get stored CRM credentials */
export async function getCrmCredentials(): Promise<{ apiToken: string; appName: string } | null> {
  const apiToken = await getSettingValue("shopnex_api_token");
  const appName = await getSettingValue("shopnex_app_name");
  if (!apiToken || !appName) return null;
  return { apiToken, appName };
}

/** Get summary data for LLM context */
export async function getLLMContextData(filters: DashboardFilters = {}) {
  const kpi = await getKPISummary(filters);
  const lifecycle = await getLifecycleDistribution(filters);
  const topReps = await getSalesRepPerformance(filters);
  const funnel = await getSalesFunnel(filters);

  return {
    kpi,
    lifecycle,
    topSalesReps: topReps.slice(0, 5),
    funnel,
  };
}
