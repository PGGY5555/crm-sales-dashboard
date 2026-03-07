import { eq, and, gte, lte, sql, inArray, desc, asc, between, like, or, count, isNotNull, ne } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, users, customers, orders, syncLogs, settings, orderItems, products } from "../drizzle/schema";
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

/** Build conditions for trend queries using shippedAt (shipment date) */
function buildTrendConditions(filters: DashboardFilters) {
  const conditions: any[] = [];
  // Only include shipped orders (must have shippedAt)
  conditions.push(sql`${orders.shippedAt} IS NOT NULL`);
  if (filters.dateRange?.from) {
    conditions.push(gte(orders.shippedAt, filters.dateRange.from));
  }
  if (filters.dateRange?.to) {
    conditions.push(lte(orders.shippedAt, filters.dateRange.to));
  }
  // Exclude cancelled orders
  conditions.push(sql`${orders.orderStatus} != -1`);
  return and(...conditions);
}

/** Get sales trend data grouped by period (based on shipment date) */
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

  // Use raw SQL to avoid Drizzle ORM GROUP BY alias issues with TiDB's only_full_group_by mode
  const whereParts: string[] = [
    "`shippedAt` IS NOT NULL",
    "`orderStatus` != -1",
  ];
  const queryParams: any[] = [];
  if (filters.dateRange?.from) {
    whereParts.push("`shippedAt` >= ?");
    queryParams.push(filters.dateRange.from);
  }
  if (filters.dateRange?.to) {
    whereParts.push("`shippedAt` <= ?");
    queryParams.push(filters.dateRange.to);
  }
  const whereClause = whereParts.join(" AND ");

  let queryStr: string;
  if (period === "quarter") {
    queryStr = `SELECT CONCAT(YEAR(shippedAt), '-Q', QUARTER(shippedAt)) as period, COALESCE(SUM(total), 0) as revenue, COUNT(*) as orderCount FROM \`orders\` WHERE ${whereClause} GROUP BY period ORDER BY period`;
  } else {
    queryStr = `SELECT DATE_FORMAT(shippedAt, '${dateFormat}') as period, COALESCE(SUM(total), 0) as revenue, COUNT(*) as orderCount FROM \`orders\` WHERE ${whereClause} GROUP BY period ORDER BY period`;
  }

  // Execute via Drizzle's raw execute
  const rawRows = await db.execute(sql.raw(
    queryParams.length > 0
      ? queryStr.replace(/\?/g, () => {
          const val = queryParams.shift();
          if (val instanceof Date) return `'${val.toISOString().slice(0, 19).replace('T', ' ')}'`;
          return typeof val === 'string' ? `'${val}'` : String(val);
        })
      : queryStr
  ));

  const rows: any[] = Array.isArray(rawRows) ? ((rawRows as any)[0] ?? rawRows) : [];
  return (Array.isArray(rows) ? rows : []).map((r: any) => ({
    period: String(r.period),
    revenue: parseFloat(r.revenue || '0'),
    orderCount: Number(r.orderCount || 0),
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

/** Clear all imported data by target type */
export async function clearAllData(targets: string[]): Promise<{ success: boolean; deleted: Record<string, number> }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const shouldClear = (t: string) => targets.includes("all") || targets.includes(t);
  const deleted: Record<string, number> = {};

  if (shouldClear("orders")) {
    // Delete order items first (foreign key dependency)
    const [itemResult] = await db.delete(orderItems).where(sql`1=1`);
    deleted.orderItems = (itemResult as any).affectedRows || 0;
    const [orderResult] = await db.delete(orders).where(sql`1=1`);
    deleted.orders = (orderResult as any).affectedRows || 0;
  }

  if (shouldClear("customers")) {
    const [custResult] = await db.delete(customers).where(sql`1=1`);
    deleted.customers = (custResult as any).affectedRows || 0;
  }

  if (shouldClear("products")) {
    const [prodResult] = await db.delete(products).where(sql`1=1`);
    deleted.products = (prodResult as any).affectedRows || 0;
  }

  return { success: true, deleted };
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

// ===== Customer Management (Advanced Filters) =====

export interface CustomerManagementFilters {
  // X-axis: text search fields
  searchField?: "customerName" | "customerPhone" | "customerEmail" | "recipientName" | "recipientPhone" | "recipientEmail";
  searchValue?: string;
  // Y-axis: condition filters
  registeredFrom?: Date;
  registeredTo?: Date;
  birthdayMonth?: number; // 1-12
  tags?: string; // comma-separated
  memberLevel?: string;
  creditsOp?: "lt" | "gt" | "eq";
  creditsValue?: number;
  totalSpentOp?: "lt" | "gt" | "eq";
  totalSpentValue?: number;
  totalOrdersOp?: "lt" | "gt" | "eq";
  totalOrdersValue?: number;
  lastPurchaseFrom?: Date;
  lastPurchaseTo?: Date;
  lastPurchaseAmountOp?: "lt" | "gt" | "eq";
  lastPurchaseAmountValue?: number;
  lastShipmentFrom?: Date;
  lastShipmentTo?: Date;
  lifecycles?: string[];
  blacklisted?: string; // '是' or '否'
  lineUid?: string; // text search
  // Pagination
  page?: number;
  limit?: number;
}

export async function getCustomerManagement(filters: CustomerManagementFilters = {}) {
  const db = await getDb();
  if (!db) return { items: [], total: 0 };

  const conditions: any[] = [];

  // X-axis: text search
  if (filters.searchValue && filters.searchField) {
    const val = `%${filters.searchValue}%`;
    switch (filters.searchField) {
      case "customerName": conditions.push(like(customers.name, val)); break;
      case "customerPhone": conditions.push(like(customers.phone, val)); break;
      case "customerEmail": conditions.push(like(customers.email, val)); break;
      case "recipientName": conditions.push(like(customers.recipientName, val)); break;
      case "recipientPhone": conditions.push(like(customers.recipientPhone, val)); break;
      case "recipientEmail": conditions.push(like(customers.recipientEmail, val)); break;
    }
  }

  // Y-axis: condition filters
  if (filters.registeredFrom) conditions.push(gte(customers.registeredAt, filters.registeredFrom));
  if (filters.registeredTo) conditions.push(lte(customers.registeredAt, filters.registeredTo));

  if (filters.birthdayMonth) {
    const month = String(filters.birthdayMonth).padStart(2, "0");
    conditions.push(sql`SUBSTRING(${customers.birthday}, 6, 2) = ${month}`);
  }

  if (filters.tags) {
    const tagList = filters.tags.split(",").map(t => t.trim()).filter(Boolean);
    for (const tag of tagList) {
      conditions.push(like(customers.tags, `%${tag}%`));
    }
  }

  if (filters.memberLevel) {
    conditions.push(eq(customers.memberLevel, filters.memberLevel));
  }

  if (filters.creditsOp && filters.creditsValue !== undefined) {
    const col = customers.credits;
    switch (filters.creditsOp) {
      case "lt": conditions.push(sql`CAST(${col} AS DECIMAL(12,2)) < ${filters.creditsValue}`); break;
      case "gt": conditions.push(sql`CAST(${col} AS DECIMAL(12,2)) > ${filters.creditsValue}`); break;
      case "eq": conditions.push(sql`CAST(${col} AS DECIMAL(12,2)) = ${filters.creditsValue}`); break;
    }
  }

  if (filters.totalSpentOp && filters.totalSpentValue !== undefined) {
    const col = customers.totalSpent;
    switch (filters.totalSpentOp) {
      case "lt": conditions.push(sql`CAST(${col} AS DECIMAL(12,2)) < ${filters.totalSpentValue}`); break;
      case "gt": conditions.push(sql`CAST(${col} AS DECIMAL(12,2)) > ${filters.totalSpentValue}`); break;
      case "eq": conditions.push(sql`CAST(${col} AS DECIMAL(12,2)) = ${filters.totalSpentValue}`); break;
    }
  }

  if (filters.totalOrdersOp && filters.totalOrdersValue !== undefined) {
    switch (filters.totalOrdersOp) {
      case "lt": conditions.push(sql`${customers.totalOrders} < ${filters.totalOrdersValue}`); break;
      case "gt": conditions.push(sql`${customers.totalOrders} > ${filters.totalOrdersValue}`); break;
      case "eq": conditions.push(sql`${customers.totalOrders} = ${filters.totalOrdersValue}`); break;
    }
  }

  if (filters.lastPurchaseFrom) conditions.push(gte(customers.lastPurchaseDate, filters.lastPurchaseFrom));
  if (filters.lastPurchaseTo) conditions.push(lte(customers.lastPurchaseDate, filters.lastPurchaseTo));

  if (filters.lastPurchaseAmountOp && filters.lastPurchaseAmountValue !== undefined) {
    const col = customers.lastPurchaseAmount;
    switch (filters.lastPurchaseAmountOp) {
      case "lt": conditions.push(sql`CAST(${col} AS DECIMAL(12,2)) < ${filters.lastPurchaseAmountValue}`); break;
      case "gt": conditions.push(sql`CAST(${col} AS DECIMAL(12,2)) > ${filters.lastPurchaseAmountValue}`); break;
      case "eq": conditions.push(sql`CAST(${col} AS DECIMAL(12,2)) = ${filters.lastPurchaseAmountValue}`); break;
    }
  }

  if (filters.lastShipmentFrom) conditions.push(gte(customers.lastShipmentAt, filters.lastShipmentFrom));
  if (filters.lastShipmentTo) conditions.push(lte(customers.lastShipmentAt, filters.lastShipmentTo));

  if (filters.lifecycles && filters.lifecycles.length > 0) {
    conditions.push(inArray(customers.lifecycle, filters.lifecycles as any));
  }

  if (filters.blacklisted) {
    conditions.push(eq(customers.blacklisted, filters.blacklisted));
  }

  if (filters.lineUid) {
    conditions.push(like(customers.lineUid, `%${filters.lineUid}%`));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const page = filters.page ?? 0;
  const limit = filters.limit ?? 50;

  const [countResult] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(customers)
    .where(where);

  const items = await db
    .select()
    .from(customers)
    .where(where)
    .orderBy(desc(customers.updatedAt))
    .limit(limit)
    .offset(page * limit);

  return {
    items,
    total: Number(countResult?.count || 0),
  };
}

/** Get all customers matching filters (for export, no pagination) */
export async function getCustomerManagementExport(filters: CustomerManagementFilters = {}) {
  const result = await getCustomerManagement({ ...filters, page: 0, limit: 100000 });
  return result.items;
}

/** Get distinct member levels for filter dropdown */
export async function getDistinctMemberLevels(): Promise<string[]> {
  const db = await getDb();
  if (!db) return [];
  const result = await db
    .select({ level: customers.memberLevel })
    .from(customers)
    .where(isNotNull(customers.memberLevel))
    .groupBy(customers.memberLevel);
  return result.map(r => r.level).filter((l): l is string => !!l);
}

// ===== Order Management (Advanced Filters) =====

export interface OrderManagementFilters {
  // X-axis: text search fields
  searchField?: "orderNumber" | "customerName" | "customerPhone" | "customerEmail" | "recipientName" | "recipientPhone" | "recipientEmail" | "deliveryNumber";
  searchValue?: string;
  // Y-axis: condition filters
  orderSource?: string;
  paymentMethod?: string;
  shippingMethod?: string;
  shippingAddress?: string;
  shippedFrom?: Date;
  shippedTo?: Date;
  logisticsStatus?: string;
  // Pagination
  page?: number;
  limit?: number;
}

export async function getOrderManagement(filters: OrderManagementFilters = {}) {
  const db = await getDb();
  if (!db) return { items: [], total: 0 };

  const conditions: any[] = [];

  // X-axis: text search
  if (filters.searchValue && filters.searchField) {
    const val = `%${filters.searchValue}%`;
    switch (filters.searchField) {
      case "orderNumber": conditions.push(like(orders.externalId, val)); break;
      case "customerName": conditions.push(like(orders.customerName, val)); break;
      case "customerPhone": conditions.push(like(orders.customerPhone, val)); break;
      case "customerEmail": conditions.push(like(orders.customerEmail, val)); break;
      case "recipientName": conditions.push(like(orders.recipientName, val)); break;
      case "recipientPhone": conditions.push(like(orders.recipientPhone, val)); break;
      case "recipientEmail": conditions.push(like(orders.recipientEmail, val)); break;
      case "deliveryNumber": conditions.push(like(orders.deliveryNumber, val)); break;
    }
  }

  // Y-axis: condition filters
  if (filters.orderSource) conditions.push(like(orders.orderSource, `%${filters.orderSource}%`));
  if (filters.paymentMethod) conditions.push(like(orders.paymentMethod, `%${filters.paymentMethod}%`));
  if (filters.shippingMethod) conditions.push(like(orders.shippingMethod, `%${filters.shippingMethod}%`));
  if (filters.shippingAddress) conditions.push(like(orders.shippingAddress, `%${filters.shippingAddress}%`));
  if (filters.shippedFrom) conditions.push(gte(orders.shippedAt, filters.shippedFrom));
  if (filters.shippedTo) conditions.push(lte(orders.shippedAt, filters.shippedTo));
  if (filters.logisticsStatus) conditions.push(eq(orders.logisticsStatus, filters.logisticsStatus));

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const page = filters.page ?? 0;
  const limit = filters.limit ?? 50;

  const [countResult] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(orders)
    .where(where);

  const items = await db
    .select({
      id: orders.id,
      externalId: orders.externalId,
      cartToken: orders.cartToken,
      customerId: orders.customerId,
      customerExternalId: orders.customerExternalId,
      customerName: orders.customerName,
      customerEmail: orders.customerEmail,
      customerPhone: orders.customerPhone,
      recipientName: orders.recipientName,
      recipientPhone: orders.recipientPhone,
      recipientEmail: orders.recipientEmail,
      orderDate: orders.orderDate,
      shippedAt: orders.shippedAt,
      total: orders.total,
      orderSource: orders.orderSource,
      paymentMethod: orders.paymentMethod,
      shippingMethod: orders.shippingMethod,
      shippingAddress: orders.shippingAddress,
      rawData: orders.rawData,
      createdAt: orders.createdAt,
      updatedAt: orders.updatedAt,
      shipmentNumber: orders.shipmentNumber,
      deliveryNumber: orders.deliveryNumber,
      logisticsStatus: orders.logisticsStatus,
      customerLineUid: customers.lineUid,
      customerBlacklisted: customers.blacklisted,
    })
    .from(orders)
    .leftJoin(customers, or(
      and(isNotNull(orders.customerId), eq(orders.customerId, customers.id)),
      and(sql`${orders.customerId} IS NULL`, isNotNull(orders.customerExternalId), eq(orders.customerExternalId, customers.externalId)),
      and(sql`${orders.customerId} IS NULL`, sql`${orders.customerExternalId} IS NULL`, isNotNull(orders.customerEmail), eq(orders.customerEmail, customers.email))
    ))
    .where(where)
    .orderBy(desc(orders.orderDate))
    .limit(limit)
    .offset(page * limit);

  return {
    items,
    total: Number(countResult?.count || 0),
  };
}

/** Get all orders matching filters (for export, no pagination) */
export async function getOrderManagementExport(filters: OrderManagementFilters = {}) {
  const result = await getOrderManagement({ ...filters, page: 0, limit: 100000 });
  return result.items;
}

/** Get distinct values for order filter dropdowns */
export async function getOrderFilterOptions() {
  const db = await getDb();
  if (!db) return { sources: [], payments: [], shippings: [] };

  const [sources] = await Promise.all([
    db.select({ val: orders.orderSource }).from(orders).where(isNotNull(orders.orderSource)).groupBy(orders.orderSource),
  ]);
  const [payments] = await Promise.all([
    db.select({ val: orders.paymentMethod }).from(orders).where(isNotNull(orders.paymentMethod)).groupBy(orders.paymentMethod),
  ]);
  const [shippings] = await Promise.all([
    db.select({ val: orders.shippingMethod }).from(orders).where(isNotNull(orders.shippingMethod)).groupBy(orders.shippingMethod),
  ]);

  return {
    sources: sources.map(r => r.val).filter((v): v is string => !!v),
    payments: payments.map(r => r.val).filter((v): v is string => !!v),
    shippings: shippings.map(r => r.val).filter((v): v is string => !!v),
  };
}

/** Batch delete customers by IDs */
export async function batchDeleteCustomers(ids: number[]): Promise<{ deleted: number }> {
  const db = await getDb();
  if (!db || ids.length === 0) return { deleted: 0 };

  // Also delete orders and order items belonging to these customers
  const customerOrders = await db.select({ id: orders.id, externalId: orders.externalId }).from(orders).where(inArray(orders.customerId, ids));
  const orderIds = customerOrders.map(o => o.id);
  const orderExtIds = customerOrders.map(o => o.externalId).filter(Boolean) as string[];
  if (orderIds.length > 0) {
    await db.delete(orderItems).where(inArray(orderItems.orderId, orderIds));
  }
  if (orderExtIds.length > 0) {
    await db.delete(orderItems).where(inArray(orderItems.orderExternalId, orderExtIds));
  }
  if (orderIds.length > 0) {
    await db.delete(orders).where(inArray(orders.id, orderIds));
  }

  const result = await db.delete(customers).where(inArray(customers.id, ids));
  return { deleted: result[0]?.affectedRows ?? ids.length };
}

/** Batch delete orders by IDs (also deletes related order items) */
export async function batchDeleteOrders(ids: number[]): Promise<{ deleted: number }> {
  const db = await getDb();
  if (!db || ids.length === 0) return { deleted: 0 };

  // Delete order items first (by orderId and by orderExternalId)
  await db.delete(orderItems).where(inArray(orderItems.orderId, ids));
  // Also delete by orderExternalId for items that may not have orderId set
  const ordersToDelete = await db.select({ externalId: orders.externalId }).from(orders).where(inArray(orders.id, ids));
  const extIdsToDelete = ordersToDelete.map(o => o.externalId).filter(Boolean) as string[];
  if (extIdsToDelete.length > 0) {
    await db.delete(orderItems).where(inArray(orderItems.orderExternalId, extIdsToDelete));
  }

  // Delete orders
  const result = await db.delete(orders).where(inArray(orders.id, ids));

  // Recalculate customer stats for affected customers
  // Get unique customer IDs from remaining orders
  const affectedCustomerIds = await db.selectDistinct({ customerId: orders.customerId })
    .from(orders)
    .where(isNotNull(orders.customerId));

  // For each customer, update totalSpent, totalOrders, lastPurchaseDate, lastPurchaseAmount, lastShipmentDate
  for (const { customerId } of affectedCustomerIds) {
    if (!customerId) continue;
    const stats = await db.select({
      totalSpent: sql<number>`COALESCE(SUM(${orders.total}), 0)`,
      totalOrders: sql<number>`COUNT(*)`,
      lastPurchaseDate: sql<number | null>`MAX(${orders.orderDate})`,
      lastPurchaseAmount: sql<number | null>`NULL`,
      lastShipmentDate: sql<number | null>`MAX(${orders.shippedAt})`,
    }).from(orders).where(eq(orders.customerId, customerId));

    if (stats[0]) {
      // Get last order amount
      const lastOrder = await db.select({ total: orders.total })
        .from(orders)
        .where(eq(orders.customerId, customerId))
        .orderBy(desc(orders.orderDate))
        .limit(1);

      await db.update(customers).set({
        totalSpent: String(stats[0].totalSpent),
        totalOrders: stats[0].totalOrders,
        lastPurchaseDate: stats[0].lastPurchaseDate ? new Date(stats[0].lastPurchaseDate) : null,
        lastPurchaseAmount: lastOrder[0]?.total ?? null,
        lastShipmentAt: stats[0].lastShipmentDate ? new Date(stats[0].lastShipmentDate) : null,
      }).where(eq(customers.id, customerId));
    }
  }

  // Also update customers who no longer have any orders
  const allCustomerIds = await db.select({ id: customers.id }).from(customers);
  const customersWithOrders = new Set(affectedCustomerIds.map(c => c.customerId));
  for (const { id } of allCustomerIds) {
    if (!customersWithOrders.has(id)) {
      await db.update(customers).set({
        totalSpent: "0",
        totalOrders: 0,
        lastPurchaseDate: null,
        lastPurchaseAmount: null,
        lastShipmentAt: null,
      }).where(eq(customers.id, id));
    }
  }

  return { deleted: result[0]?.affectedRows ?? ids.length };
}

/** Get customer detail by ID */
export async function getCustomerDetail(customerId: number) {
  const db = await getDb();
  if (!db) return null;

  const [customer] = await db.select().from(customers).where(eq(customers.id, customerId));
  if (!customer) return null;

  // Get all orders for this customer
  const customerOrders = await db
    .select()
    .from(orders)
    .where(eq(orders.customerId, customerId))
    .orderBy(desc(orders.orderDate));

  // Get order items for each order - try by orderId first, fallback to orderExternalId
  const orderIds = customerOrders.map(o => o.id);
  const orderExternalIds = customerOrders.map(o => o.externalId).filter(Boolean) as string[];
  let items: any[] = [];
  if (orderIds.length > 0) {
    items = await db
      .select()
      .from(orderItems)
      .where(inArray(orderItems.orderId, orderIds));
  }
  // Fallback: also fetch by orderExternalId for items without orderId
  if (orderExternalIds.length > 0) {
    const extItems = await db
      .select()
      .from(orderItems)
      .where(inArray(orderItems.orderExternalId, orderExternalIds));
    // Merge, avoiding duplicates
    const existingIds = new Set(items.map(i => i.id));
    for (const ei of extItems) {
      if (!existingIds.has(ei.id)) items.push(ei);
    }
  }

  // Build externalId -> orderId mapping
  const extToId: Record<string, number> = {};
  for (const o of customerOrders) {
    if (o.externalId) extToId[o.externalId] = o.id;
  }

  // Group items by orderId (resolve via orderId or orderExternalId)
  const itemsByOrder: Record<number, typeof items> = {};
  for (const item of items) {
    const oid = item.orderId || (item.orderExternalId ? extToId[item.orderExternalId] : null);
    if (oid) {
      if (!itemsByOrder[oid]) itemsByOrder[oid] = [];
      itemsByOrder[oid].push(item);
    }
  }

  return {
    customer,
    orders: customerOrders.map(o => ({
      ...o,
      items: itemsByOrder[o.id] || [],
    })),
  };
}

/** Get order detail by ID */
export async function getOrderDetail(orderId: number) {
  const db = await getDb();
  if (!db) return null;

  const [order] = await db
    .select()
    .from(orders)
    .where(eq(orders.id, orderId));
  if (!order) return null;

  // Get customer info
  let customer = null;
  if (order.customerId) {
    const [c] = await db.select().from(customers).where(eq(customers.id, order.customerId));
    customer = c || null;
  }
  if (!customer && order.customerExternalId) {
    const [c] = await db.select().from(customers).where(eq(customers.externalId, order.customerExternalId));
    customer = c || null;
  }
  if (!customer && order.customerEmail) {
    const [c] = await db.select().from(customers).where(eq(customers.email, order.customerEmail));
    customer = c || null;
  }

  // Get order items - try by orderId first, then by orderExternalId
  let items = await db
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId));

  // Fallback: match by orderExternalId if no items found by orderId
  if (items.length === 0 && order.externalId) {
    items = await db
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderExternalId, order.externalId));
  }

  return {
    order,
    customer,
    items,
  };
}
