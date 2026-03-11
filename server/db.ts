import { eq, and, gte, lte, sql, inArray, desc, asc, between, like, or, count, isNotNull, ne, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, users, customers, orders, syncLogs, settings, orderItems, products, userPermissions, auditLogs } from "../drizzle/schema";
import { getDefaultPermissions, getAllPermissions, type PermissionKey } from "../shared/permissions";
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

// ===== User Management & Permissions =====

/** Get all users list */
export async function getAllUsers() {
  const db = await getDb();
  if (!db) return [];
  const result = await db.select({
    id: users.id,
    openId: users.openId,
    name: users.name,
    email: users.email,
    role: users.role,
    loginMethod: users.loginMethod,
    createdAt: users.createdAt,
    lastSignedIn: users.lastSignedIn,
  }).from(users).orderBy(desc(users.lastSignedIn));
  return result;
}

/** Remove a user (cannot remove admin/owner) */
export async function removeUser(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Delete permissions first
  await db.delete(userPermissions).where(eq(userPermissions.userId, userId));
  // Delete user
  await db.delete(users).where(eq(users.id, userId));
  return { success: true };
}

/** Get user permissions by userId */
export async function getUserPermissions(userId: number): Promise<Record<PermissionKey, boolean>> {
  const db = await getDb();
  if (!db) return getDefaultPermissions();
  const result = await db.select().from(userPermissions).where(eq(userPermissions.userId, userId)).limit(1);
  if (result.length === 0) return getDefaultPermissions();
  // Merge with defaults to handle new permission keys
  const stored = (result[0].permissions as Record<string, boolean>) || {};
  const defaults = getDefaultPermissions();
  return { ...defaults, ...stored } as Record<PermissionKey, boolean>;
}

/** Save user permissions */
export async function saveUserPermissions(userId: number, permissions: Record<string, boolean>, updatedBy: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(userPermissions).values({
    userId,
    permissions,
    updatedBy,
  }).onDuplicateKeyUpdate({
    set: {
      permissions,
      updatedBy,
    },
  });
  return { success: true };
}

/** Check if a user has a specific permission. Admin always has all permissions. */
export async function checkUserPermission(userId: number, userRole: string, permissionKey: PermissionKey): Promise<boolean> {
  if (userRole === "admin") return true;
  const perms = await getUserPermissions(userId);
  return perms[permissionKey] === true;
}

/** Update user role */
export async function updateUserRole(userId: number, role: "user" | "admin") {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(users).set({ role }).where(eq(users.id, userId));
  return { success: true };
}

/** Pre-create a user by email (before they log in) */
export async function preCreateUser(email: string, role: "user" | "admin", createdBy: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Check if email already exists
  const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing.length > 0) {
    throw new Error("此 Email 已存在於系統中");
  }
  // Create user with a placeholder openId (will be updated on first login)
  const placeholderOpenId = `pending_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  await db.insert(users).values({
    openId: placeholderOpenId,
    email,
    role,
    name: email.split("@")[0],
  });
  const newUser = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return newUser[0];
}

// ===== Audit Log Helpers =====

export interface AuditLogEntry {
  userId?: number;
  userName?: string;
  userEmail?: string;
  action: string;
  category: string;
  description?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
}

/** Record an audit log entry */
export async function logAudit(entry: AuditLogEntry) {
  const db = await getDb();
  if (!db) {
    console.warn("[AuditLog] Database not available, skipping log:", entry.action);
    return;
  }
  try {
    await db.insert(auditLogs).values({
      userId: entry.userId ?? null,
      userName: entry.userName ?? null,
      userEmail: entry.userEmail ?? null,
      action: entry.action,
      category: entry.category,
      description: entry.description ?? null,
      details: entry.details ?? null,
      ipAddress: entry.ipAddress ?? null,
    });
  } catch (err) {
    console.error("[AuditLog] Failed to write log:", err);
  }
}

/** Query audit logs with pagination and filters */
export async function getAuditLogs(opts: {
  page?: number;
  pageSize?: number;
  category?: string;
  action?: string;
  userId?: number;
  dateFrom?: Date;
  dateTo?: Date;
  search?: string;
}) {
  const db = await getDb();
  if (!db) return { logs: [], total: 0 };
  const page = opts.page ?? 1;
  const pageSize = opts.pageSize ?? 50;
  const offset = (page - 1) * pageSize;

  const conditions: SQL[] = [];
  if (opts.category) conditions.push(eq(auditLogs.category, opts.category));
  if (opts.action) conditions.push(eq(auditLogs.action, opts.action));
  if (opts.userId) conditions.push(eq(auditLogs.userId, opts.userId));
  if (opts.dateFrom) conditions.push(gte(auditLogs.createdAt, opts.dateFrom));
  if (opts.dateTo) conditions.push(lte(auditLogs.createdAt, opts.dateTo));
  if (opts.search) {
    conditions.push(
      or(
        like(auditLogs.description, `%${opts.search}%`),
        like(auditLogs.userName, `%${opts.search}%`),
        like(auditLogs.userEmail, `%${opts.search}%`)
      )!
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [logs, countResult] = await Promise.all([
    db.select().from(auditLogs)
      .where(whereClause)
      .orderBy(desc(auditLogs.createdAt))
      .limit(pageSize)
      .offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(auditLogs).where(whereClause),
  ]);

  return {
    logs,
    total: Number(countResult[0]?.count ?? 0),
  };
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
    .orderBy(desc(customers.lastShipmentAt))
    .limit(limit)
    .offset(page * limit);

  return {
    items,
    total: Number(countResult?.count || 0),
  };
}

/** Get customer analytics stats */
export async function getCustomerAnalyticsStats(filters: DashboardFilters = {}) {
  const db = await getDb();
  if (!db) return null;

  const conditions: any[] = [];
  if (filters.lifecycles && filters.lifecycles.length > 0) {
    conditions.push(inArray(customers.lifecycle, filters.lifecycles as any));
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [stats] = await db
    .select({
      totalCustomers: sql<number>`COUNT(*)`,
      activeCustomers: sql<number>`SUM(CASE WHEN ${customers.totalOrders} > 0 THEN 1 ELSE 0 END)`,
      avgSpent: sql<string>`COALESCE(AVG(CASE WHEN ${customers.totalSpent} > 0 THEN ${customers.totalSpent} END), 0)`,
      avgOrders: sql<string>`COALESCE(AVG(CASE WHEN ${customers.totalOrders} > 0 THEN ${customers.totalOrders} END), 0)`,
      avgRepurchaseDays: sql<string>`COALESCE(AVG(${customers.avgRepurchaseDays}), 0)`,
      totalRevenue: sql<string>`COALESCE(SUM(${customers.totalSpent}), 0)`,
      repurchaseRate: sql<string>`COALESCE(
        SUM(CASE WHEN ${customers.totalOrders} > 1 THEN 1 ELSE 0 END) * 100.0 / 
        NULLIF(SUM(CASE WHEN ${customers.totalOrders} > 0 THEN 1 ELSE 0 END), 0)
      , 0)`,
    })
    .from(customers)
    .where(where);

  return {
    totalCustomers: Number(stats?.totalCustomers || 0),
    activeCustomers: Number(stats?.activeCustomers || 0),
    avgSpent: parseFloat(String(stats?.avgSpent || '0')),
    avgOrders: parseFloat(String(stats?.avgOrders || '0')),
    avgRepurchaseDays: Math.round(parseFloat(String(stats?.avgRepurchaseDays || '0'))),
    totalRevenue: parseFloat(String(stats?.totalRevenue || '0')),
    repurchaseRate: parseFloat(String(stats?.repurchaseRate || '0')),
  };
}

/** Get monthly customer registration trend */
export async function getCustomerRegistrationTrend(filters: DashboardFilters = {}) {
  const db = await getDb();
  if (!db) return [];

  const conditions: any[] = [];
  conditions.push(isNotNull(customers.registeredAt));
  if (filters.lifecycles && filters.lifecycles.length > 0) {
    conditions.push(inArray(customers.lifecycle, filters.lifecycles as any));
  }
  const where = and(...conditions);

  // Use raw SQL to avoid Drizzle's column reference mismatch in GROUP BY with only_full_group_by mode
  const lifecycleClause = (filters.lifecycles && filters.lifecycles.length > 0)
    ? `AND \`lifecycle\` IN (${filters.lifecycles.map(l => `'${l}'`).join(',')})`
    : '';
  const rawResult = await db.execute(sql.raw(
    `SELECT DATE_FORMAT(registeredAt, '%Y-%m') as month, COUNT(*) as count, COALESCE(SUM(totalSpent), 0) as totalSpent FROM \`customers\` WHERE registeredAt IS NOT NULL ${lifecycleClause} GROUP BY month ORDER BY month`
  ));
  const result = (Array.isArray(rawResult) ? rawResult[0] : rawResult) as unknown as any[];

  return result.map(r => ({
    month: r.month,
    count: Number(r.count),
    totalSpent: parseFloat(String(r.totalSpent)),
  }));
}

/** Get KPI stats filtered by last shipment date range */
export async function getShipmentDateKPI(input: { from?: Date; to?: Date }) {
  const db = await getDb();
  if (!db) return null;

  const conditions: any[] = [];
  // Must have lastShipmentAt
  conditions.push(isNotNull(customers.lastShipmentAt));
  if (input.from) {
    conditions.push(sql`${customers.lastShipmentAt} >= ${input.from}`);
  }
  if (input.to) {
    conditions.push(sql`${customers.lastShipmentAt} <= ${input.to}`);
  }
  const where = and(...conditions);

  const [stats] = await db
    .select({
      customerCount: sql<number>`COUNT(*)`,
      totalRevenue: sql<string>`COALESCE(SUM(${customers.totalSpent}), 0)`,
      avgSpent: sql<string>`COALESCE(AVG(CASE WHEN ${customers.totalSpent} > 0 THEN ${customers.totalSpent} END), 0)`,
      avgRepurchaseDays: sql<string>`COALESCE(AVG(CASE WHEN ${customers.avgRepurchaseDays} > 0 THEN ${customers.avgRepurchaseDays} END), 0)`,
      repurchaseCustomers: sql<number>`SUM(CASE WHEN ${customers.totalOrders} > 1 THEN 1 ELSE 0 END)`,
      activeCustomers: sql<number>`SUM(CASE WHEN ${customers.totalOrders} > 0 THEN 1 ELSE 0 END)`,
      totalOrders: sql<number>`COALESCE(SUM(${customers.totalOrders}), 0)`,
    })
    .from(customers)
    .where(where);

  const customerCount = Number(stats?.customerCount || 0);
  const totalRevenue = parseFloat(String(stats?.totalRevenue || '0'));
  const activeCustomers = Number(stats?.activeCustomers || 0);
  const repurchaseCustomers = Number(stats?.repurchaseCustomers || 0);
  const totalOrders = Number(stats?.totalOrders || 0);

  return {
    customerCount,
    totalRevenue,
    avgSpent: parseFloat(String(stats?.avgSpent || '0')),
    avgRepurchaseDays: Math.round(parseFloat(String(stats?.avgRepurchaseDays || '0'))),
    repurchaseRate: activeCustomers > 0
      ? (repurchaseCustomers / activeCustomers) * 100
      : 0,
    avgOrderValue: totalOrders > 0
      ? totalRevenue / totalOrders
      : 0,
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
  searchField?: "customerName" | "customerPhone" | "customerEmail" | "recipientName" | "recipientPhone" | "recipientEmail" | "mobileCarrier" | "taxId";
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
  sfShippedFrom?: Date;
  sfShippedTo?: Date;
  gender?: string; // 性別篩選
  company?: string; // 公司名稱搜尋
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
      case "mobileCarrier": conditions.push(like(customers.mobileCarrier, val)); break;
      case "taxId": conditions.push(like(customers.taxId, val)); break;
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

  if (filters.sfShippedFrom) conditions.push(gte(customers.sfShippedAt, filters.sfShippedFrom));
  if (filters.sfShippedTo) conditions.push(lte(customers.sfShippedAt, filters.sfShippedTo));

  if (filters.gender) {
    conditions.push(eq(customers.gender, filters.gender));
  }

  if (filters.company) {
    conditions.push(like(customers.company, `%${filters.company}%`));
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
    .orderBy(desc(customers.registeredAt))
    .limit(limit)
    .offset(page * limit);

  // Fetch interval order counts for tooltip display
  let intervalStats: Map<number, { ordersIn6m: number; ordersIn6to12m: number; ltvOneYear: number }> = new Map();
  if (items.length > 0) {
    const now = new Date();
    const sixMonthsAgo = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
    const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
    const fmt = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ");
    const customerIds = items.map(c => c.id);
    
    // Process in batches of 500 to avoid SQL IN clause limits
    const BATCH_SIZE = 500;
    try {
      for (let i = 0; i < customerIds.length; i += BATCH_SIZE) {
        const batchIds = customerIds.slice(i, i + BATCH_SIZE);
        const rawResult: any = await db.execute(sql`
          SELECT customerId,
            SUM(CASE WHEN shippedAt >= ${fmt(sixMonthsAgo)} AND shippedAt <= ${fmt(now)} THEN 1 ELSE 0 END) AS ordersIn6m,
            SUM(CASE WHEN shippedAt >= ${fmt(oneYearAgo)} AND shippedAt < ${fmt(sixMonthsAgo)} THEN 1 ELSE 0 END) AS ordersIn6to12m,
            COALESCE(SUM(CASE WHEN orderDate >= ${fmt(oneYearAgo)} THEN CAST(total AS DECIMAL(12,2)) ELSE 0 END), 0) AS ltvOneYear
          FROM orders
          WHERE customerId IN (${sql.join(batchIds.map(id => sql`${id}`), sql`, `)})
            AND orderStatus != -1 AND isShipped = 1 AND shippedAt IS NOT NULL
            AND (orderStatusText = '已完成' OR orderStatusText IS NULL) AND (shippingStatus IS NULL OR shippingStatus != '已退貨')
          GROUP BY customerId
        `);
        // db.execute returns [rows, fields] - extract rows
        const statsRows: any[] = Array.isArray(rawResult[0]) && rawResult[0].length > 0 && typeof rawResult[0][0] === 'object' && 'customerId' in rawResult[0][0]
          ? rawResult[0]
          : rawResult;
        for (const row of statsRows) {
          if (!row || typeof row !== 'object' || !('customerId' in row)) continue;
          intervalStats.set(Number(row.customerId), {
            ordersIn6m: Number(row.ordersIn6m || 0),
            ordersIn6to12m: Number(row.ordersIn6to12m || 0),
            ltvOneYear: parseFloat(String(row.ltvOneYear || 0)),
          });
        }
      }
    } catch (e) {
      // Silently fail - tooltip data is non-critical
    }
  }

  const enrichedItems = items.map(c => ({
    ...c,
    ordersIn6m: intervalStats.get(c.id)?.ordersIn6m ?? 0,
    ordersIn6to12m: intervalStats.get(c.id)?.ordersIn6to12m ?? 0,
    ltvOneYear: intervalStats.get(c.id)?.ltvOneYear ?? 0,
  }));

  // Aggregate stats for filtered results (only when filters are active)
  let aggregateStats = null;
  const hasActiveFilters = !!(filters.registeredFrom || filters.registeredTo || filters.birthdayMonth || filters.tags || filters.memberLevel || (filters.creditsOp && filters.creditsValue !== undefined) || (filters.totalSpentOp && filters.totalSpentValue !== undefined) || (filters.totalOrdersOp && filters.totalOrdersValue !== undefined) || filters.lastPurchaseFrom || filters.lastPurchaseTo || (filters.lastPurchaseAmountOp && filters.lastPurchaseAmountValue !== undefined) || filters.lastShipmentFrom || filters.lastShipmentTo || (filters.lifecycles && filters.lifecycles.length > 0) || filters.blacklisted || filters.lineUid || filters.gender || filters.company || (filters.searchValue && filters.searchField));
  if (hasActiveFilters) {
    try {
      const [statsResult] = await db
        .select({
          totalCount: sql<number>`COUNT(*)`,
          blacklistCount: sql<number>`SUM(CASE WHEN ${customers.blacklisted} = '是' THEN 1 ELSE 0 END)`,
          orders0: sql<number>`SUM(CASE WHEN COALESCE(${customers.totalOrders}, 0) = 0 THEN 1 ELSE 0 END)`,
          orders1: sql<number>`SUM(CASE WHEN ${customers.totalOrders} = 1 THEN 1 ELSE 0 END)`,
          orders2: sql<number>`SUM(CASE WHEN ${customers.totalOrders} = 2 THEN 1 ELSE 0 END)`,
          orders3plus: sql<number>`SUM(CASE WHEN ${customers.totalOrders} >= 3 THEN 1 ELSE 0 END)`,
          totalSpentSum: sql<string>`COALESCE(SUM(CAST(${customers.totalSpent} AS DECIMAL(14,2))), 0)`,
        })
        .from(customers)
        .where(where);

      aggregateStats = {
        totalCount: Number(statsResult?.totalCount || 0),
        blacklistCount: Number(statsResult?.blacklistCount || 0),
        orders0: Number(statsResult?.orders0 || 0),
        orders1: Number(statsResult?.orders1 || 0),
        orders2: Number(statsResult?.orders2 || 0),
        orders3plus: Number(statsResult?.orders3plus || 0),
        totalSpentSum: parseFloat(String(statsResult?.totalSpentSum || "0")),
      };
    } catch (e) {
      // Non-critical, continue without stats
    }
  }

  return {
    items: enrichedItems,
    total: Number(countResult?.count || 0),
    aggregateStats,
  };
}

/** Get all customers matching filters (for export, no pagination) */
export async function getCustomerManagementExport(filters: CustomerManagementFilters = {}) {
  const result = await getCustomerManagement({ ...filters, page: 0, limit: 100000 });
  return result.items;
}

/** Get all customer IDs matching filters (for batch operations) */
export async function getCustomerIdsByFilters(filters: CustomerManagementFilters): Promise<number[]> {
  const result = await getCustomerManagement({ ...filters, page: 0, limit: 100000 });
  return result.items.map((c: any) => c.id);
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
  shippingStatus?: string;
  orderStatusText?: string;
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
  if (filters.shippingStatus) conditions.push(eq(orders.shippingStatus, filters.shippingStatus));
  if (filters.orderStatusText) conditions.push(eq(orders.orderStatusText, filters.orderStatusText));

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
      shippingStatus: orders.shippingStatus,
      orderStatusText: orders.orderStatusText,
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

  // Aggregate stats for filtered results (only when filters are active)
  let aggregateStats = null;
  const hasActiveFilters = !!(filters.orderSource || filters.paymentMethod || filters.shippingMethod || filters.shippingAddress || filters.shippedFrom || filters.shippedTo || filters.logisticsStatus || filters.shippingStatus || filters.orderStatusText || (filters.searchValue && filters.searchField));
  if (hasActiveFilters) {
    try {
      // Combined: total amount + count in single query
      const [amountResult] = await db
        .select({
          totalAmount: sql<string>`COALESCE(SUM(CAST(${orders.total} AS DECIMAL(14,2))), 0)`,
        })
        .from(orders)
        .where(where);

      // Blacklist count: use raw SQL subquery to avoid Drizzle subquery JOIN issues
      const [blacklistResult] = await db
        .select({
          blacklistCount: sql<number>`COUNT(*)`,
        })
        .from(customers)
        .where(and(
          eq(customers.blacklisted, '是'),
          sql`${customers.id} IN (SELECT DISTINCT ${orders.customerId} FROM ${orders} WHERE ${where} AND ${orders.customerId} IS NOT NULL)`
        ));

      // Shipping method distribution
      const shippingDist = await db
        .select({
          method: orders.shippingMethod,
          count: sql<number>`COUNT(*)`,
        })
        .from(orders)
        .where(where)
        .groupBy(orders.shippingMethod);

      // Payment method amount distribution
      const paymentDist = await db
        .select({
          method: orders.paymentMethod,
          totalAmount: sql<string>`COALESCE(SUM(CAST(${orders.total} AS DECIMAL(14,2))), 0)`,
        })
        .from(orders)
        .where(where)
        .groupBy(orders.paymentMethod);

      aggregateStats = {
        totalCount: Number(countResult?.count || 0),
        blacklistCount: Number(blacklistResult?.blacklistCount || 0),
        totalAmount: parseFloat(String(amountResult?.totalAmount || "0")),
        shippingDistribution: shippingDist.map(s => ({ method: s.method || "未指定", count: Number(s.count) })),
        paymentDistribution: paymentDist.map(p => ({ method: p.method || "未指定", totalAmount: parseFloat(String(p.totalAmount || "0")) })),
      };
    } catch (e) {
      console.error('[OrderMgmt] aggregateStats error:', e);
      // Non-critical, continue without stats
    }
  }

  return {
    items,
    total: Number(countResult?.count || 0),
    aggregateStats,
  };
}

/** Get all orders matching filters (for export, no pagination) */
export async function getOrderManagementExport(filters: OrderManagementFilters = {}) {
  const result = await getOrderManagement({ ...filters, page: 0, limit: 100000 });
  return result.items;
}

/** Get all order IDs matching filters (for batch operations) */
export async function getOrderIdsByFilters(filters: OrderManagementFilters): Promise<number[]> {
  const result = await getOrderManagement({ ...filters, page: 0, limit: 100000 });
  return result.items.map((o: any) => o.id);
}

/** Get distinct values for order filter dropdowns */
export async function getOrderFilterOptions() {
  const db = await getDb();
  if (!db) return { sources: [], payments: [], shippings: [], orderStatuses: [], shippingStatuses: [] };

  const [sources, payments, shippings, orderStatuses, shippingStatuses] = await Promise.all([
    db.select({ val: orders.orderSource }).from(orders).where(isNotNull(orders.orderSource)).groupBy(orders.orderSource),
    db.select({ val: orders.paymentMethod }).from(orders).where(isNotNull(orders.paymentMethod)).groupBy(orders.paymentMethod),
    db.select({ val: orders.shippingMethod }).from(orders).where(isNotNull(orders.shippingMethod)).groupBy(orders.shippingMethod),
    db.select({ val: orders.orderStatusText }).from(orders).where(isNotNull(orders.orderStatusText)).groupBy(orders.orderStatusText),
    db.select({ val: orders.shippingStatus }).from(orders).where(isNotNull(orders.shippingStatus)).groupBy(orders.shippingStatus),
  ]);

  return {
    sources: sources.map(r => r.val).filter((v): v is string => !!v),
    payments: payments.map(r => r.val).filter((v): v is string => !!v),
    shippings: shippings.map(r => r.val).filter((v): v is string => !!v),
    orderStatuses: orderStatuses.map(r => r.val).filter((v): v is string => !!v),
    shippingStatuses: shippingStatuses.map(r => r.val).filter((v): v is string => !!v),
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
  // Only count orders with orderStatusText='已完成' and shippingStatus!='已退貨'
  for (const { customerId } of affectedCustomerIds) {
    if (!customerId) continue;
    const validCondition = and(
      eq(orders.customerId, customerId),
      sql`(${orders.orderStatusText} = '已完成' OR ${orders.orderStatusText} IS NULL)`,
      sql`(${orders.shippingStatus} IS NULL OR ${orders.shippingStatus} != '已退貨')`
    );
    const stats = await db.select({
      totalSpent: sql<number>`COALESCE(SUM(${orders.total}), 0)`,
      totalOrders: sql<number>`COUNT(*)`,
      lastPurchaseDate: sql<number | null>`MAX(${orders.orderDate})`,
      lastPurchaseAmount: sql<number | null>`NULL`,
      lastShipmentDate: sql<number | null>`MAX(${orders.shippedAt})`,
    }).from(orders).where(validCondition);

    if (stats[0]) {
      // Get last order amount (also only from valid orders)
      const lastOrder = await db.select({ total: orders.total })
        .from(orders)
        .where(and(
          eq(orders.customerId, customerId),
          sql`(${orders.orderStatusText} = '已完成' OR ${orders.orderStatusText} IS NULL)`,
          sql`(${orders.shippingStatus} IS NULL OR ${orders.shippingStatus} != '已退貨')`
        ))
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

/** Update customer fields */
export async function updateCustomer(customerId: number, data: {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  birthday?: string | null;
  tags?: string | null;
  memberLevel?: string | null;
  credits?: string | null;
  recipientName?: string | null;
  recipientPhone?: string | null;
  recipientEmail?: string | null;
  notes?: string | null;
  note1?: string | null;
  note2?: string | null;
  custom1?: string | null;
  custom2?: string | null;
  custom3?: string | null;
  blacklisted?: string | null;
  lineUid?: string | null;
  address?: string | null;
  gender?: string | null;
  mobileCarrier?: string | null;
  taxId?: string | null;
  company?: string | null;
}) {
  const db = await getDb();
  if (!db) return null;

  await db.update(customers).set(data).where(eq(customers.id, customerId));

  const [updated] = await db.select().from(customers).where(eq(customers.id, customerId));
  return updated || null;
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


/**
 * Recalculate lifecycle for ALL customers using batch SQL.
 * Uses the referenceDate as "today" to compute 180-day and 365-day intervals.
 * Returns the number of customers updated.
 */
export async function recalculateAllLifecycles(referenceDate: Date): Promise<{
  total: number;
  updated: number;
  distribution: Record<string, number>;
  transitions: Record<string, number>;
}> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const refTime = referenceDate.getTime();
  const sixMonthsMs = 180 * 24 * 60 * 60 * 1000;
  const oneYearMs = 365 * 24 * 60 * 60 * 1000;
  const sixMonthsAgo = new Date(refTime - sixMonthsMs);
  const oneYearAgo = new Date(refTime - oneYearMs);

  // Format dates as MySQL-compatible strings for raw SQL
  const fmt = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');
  const refDateStr = fmt(referenceDate);
  const sixMonthsAgoStr = fmt(sixMonthsAgo);
  const oneYearAgoStr = fmt(oneYearAgo);

  // Step 1: Get all customers with their lastShipmentAt, registeredAt, and current lifecycle
  const allCustomers = await db
    .select({
      id: customers.id,
      externalId: customers.externalId,
      lastShipmentAt: customers.lastShipmentAt,
      registeredAt: customers.registeredAt,
      lifecycle: customers.lifecycle,
    })
    .from(customers);

  // Step 2: Query orders table directly (much faster than LEFT JOIN with OR)
  // Only customers with shipped orders will appear; others default to 0
  const shippedOrderStats = await db.execute(sql`
    SELECT 
      o.customerId,
      SUM(CASE WHEN o.shippedAt >= ${sixMonthsAgoStr} AND o.shippedAt <= ${refDateStr} THEN 1 ELSE 0 END) AS ordersIn6m,
      SUM(CASE WHEN o.shippedAt >= ${oneYearAgoStr} AND o.shippedAt < ${sixMonthsAgoStr} THEN 1 ELSE 0 END) AS ordersIn6to12m
    FROM orders o
    WHERE o.orderStatus != -1
      AND o.isShipped = 1
      AND o.shippedAt IS NOT NULL
      AND o.customerId IS NOT NULL
      AND (o.orderStatusText = '已完成' OR o.orderStatusText IS NULL)
      AND (o.shippingStatus IS NULL OR o.shippingStatus != '已退貨')
    GROUP BY o.customerId
  `);

  // Build lookup map
  const statsMap = new Map<number, { ordersIn6m: number; ordersIn6to12m: number }>();
  const rows = (shippedOrderStats as any)[0] || shippedOrderStats;
  if (Array.isArray(rows)) {
    for (const row of rows) {
      statsMap.set(Number(row.customerId), {
        ordersIn6m: Number(row.ordersIn6m || 0),
        ordersIn6to12m: Number(row.ordersIn6to12m || 0),
      });
    }
  }

  // Step 3: Classify each customer and batch update
  const { classifyCustomer } = await import("./sync");
  const distribution: Record<string, number> = { N: 0, A: 0, S: 0, L: 0, D: 0, O: 0 };
  const BATCH_SIZE = 500;
  let updated = 0;

  // Group updates by lifecycle to minimize SQL calls
  const lifecycleUpdates: Record<string, number[]> = { N: [], A: [], S: [], L: [], D: [], O: [] };

  // Track transitions: "N→A": count
  const transitions: Record<string, number> = {};

  for (const cust of allCustomers) {
    const stats = statsMap.get(cust.id) || { ordersIn6m: 0, ordersIn6to12m: 0 };
    const newLifecycle = classifyCustomer(
      cust.lastShipmentAt,
      cust.registeredAt,
      stats.ordersIn6m,
      stats.ordersIn6to12m,
      referenceDate
    );
    distribution[newLifecycle] = (distribution[newLifecycle] || 0) + 1;
    lifecycleUpdates[newLifecycle].push(cust.id);

    // Record transition if lifecycle changed
    const oldLifecycle = cust.lifecycle || "O";
    if (oldLifecycle !== newLifecycle) {
      const key = `${oldLifecycle}→${newLifecycle}`;
      transitions[key] = (transitions[key] || 0) + 1;
    }
  }

  // Batch update by lifecycle category
  for (const [lifecycle, ids] of Object.entries(lifecycleUpdates)) {
    if (ids.length === 0) continue;
    // Process in sub-batches
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const batch = ids.slice(i, i + BATCH_SIZE);
      await db.execute(sql`
        UPDATE customers 
        SET lifecycle = ${lifecycle}
        WHERE id IN (${sql.join(batch.map(id => sql`${id}`), sql`, `)})
      `);
      updated += batch.length;
    }
  }

  return {
    total: allCustomers.length,
    updated,
    distribution,
    transitions,
  };
}

/** Batch update customers by IDs - update memberLevel, blacklisted, credits */
export async function batchUpdateCustomers(
  ids: number[],
  updates: { memberLevel?: string; blacklisted?: string; credits?: string }
): Promise<{ updated: number }> {
  const db = await getDb();
  if (!db || ids.length === 0) return { updated: 0 };

  // Build SET clause dynamically based on provided fields
  const setClauses: any[] = [];
  if (updates.memberLevel !== undefined) {
    setClauses.push(sql`memberLevel = ${updates.memberLevel}`);
  }
  if (updates.blacklisted !== undefined) {
    setClauses.push(sql`blacklisted = ${updates.blacklisted}`);
  }
  if (updates.credits !== undefined) {
    setClauses.push(sql`credits = ${updates.credits}`);
  }

  if (setClauses.length === 0) return { updated: 0 };

  const setClause = sql.join(setClauses, sql`, `);

  // Process in batches of 500
  const BATCH_SIZE = 500;
  let totalUpdated = 0;
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE);
    await db.execute(sql`
      UPDATE customers 
      SET ${setClause}
      WHERE id IN (${sql.join(batch.map(id => sql`${id}`), sql`, `)})
    `);
    totalUpdated += batch.length;
  }

  return { updated: totalUpdated };
}
