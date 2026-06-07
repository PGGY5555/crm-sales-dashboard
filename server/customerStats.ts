import { sql, eq, inArray } from "drizzle-orm";
import { customers, orders } from "../drizzle/schema";
import { classifyCustomer, calculateRepurchaseDays } from "./sync";
import {
  type ImportStatsHints,
  hasImportStatsHints,
  mergeImportStatsHints,
  parseImportStatsHints,
} from "../shared/importStats";

export type { ImportStatsHints };
export { mergeImportStatsHints, parseImportStatsHints, hasImportStatsHints };

/** Raw SQL: valid orderStatusText values for customer consumption stats. */
export const VALID_ORDER_STATUS_SQL =
  "(orderStatusText = '已完成' OR orderStatusText = '已出貨' OR orderStatusText IS NULL)";

/** Raw SQL: full WHERE clause for stats-eligible orders (without customerId filter). */
export function validOrderStatsWhere(prefix = ""): string {
  const os = prefix ? `${prefix}orderStatus` : "orderStatus";
  const ost = prefix ? `${prefix}orderStatusText` : "orderStatusText";
  const ss = prefix ? `${prefix}shippingStatus` : "shippingStatus";
  return `${os} != -1 AND (${ost} = '已完成' OR ${ost} = '已出貨' OR ${ost} IS NULL) AND (${ss} IS NULL OR ${ss} != '已退貨')`;
}

export const VALID_ORDER_STATS_WHERE = validOrderStatsWhere();

export function validOrderStatusSql(prefix = ""): string {
  const col = prefix ? `${prefix}orderStatusText` : "orderStatusText";
  return `(${col} = '已完成' OR ${col} = '已出貨' OR ${col} IS NULL)`;
}

export function validOrderStatusDrizzle() {
  return sql`(${orders.orderStatusText} = '已完成' OR ${orders.orderStatusText} = '已出貨' OR ${orders.orderStatusText} IS NULL)`;
}

type OrderStatsFields = {
  orderStatus?: number | null;
  orderStatusText?: string | null;
  shippingStatus?: string | null;
};

/** Whether an order should count toward customer consumption statistics. */
export function isValidOrderForStats(order: OrderStatsFields): boolean {
  if (order.orderStatus === -1) return false;
  if (order.shippingStatus === "已退貨") return false;
  const text = order.orderStatusText?.trim();
  if (!text) return true;
  return text === "已完成" || text === "已出貨";
}

/** Max IDs per IN clause when recalculating customer stats (heavy JOIN + window queries). */
export const CUSTOMER_ID_STATS_BATCH = 150;

/** Max rows per IN clause for lighter hint lookups / order linking. */
const HINTS_LOOKUP_BATCH = 500;

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}

function escSqlString(val: string): string {
  return `'${val.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

function filterValidEmails(emails: string[]): string[] {
  const placeholders = new Set(["n/a", "na", "none", "null", "undefined", "-", "無", "沒有", "無資料"]);
  return Array.from(new Set(
    emails
      .map((e) => e.trim())
      .filter((e) => e.length >= 3 && e.includes("@") && !placeholders.has(e.toLowerCase())),
  ));
}

function filterValidPhones(phones: string[]): string[] {
  return Array.from(new Set(
    phones
      .map((p) => p.trim())
      .filter((p) => p.length >= 8 && !/^0+$/.test(p)),
  ));
}

async function linkOrdersByExternalIds(
  db: NonNullable<Awaited<ReturnType<typeof import("./db").getDb>>>,
  orderExternalIds: string[],
) {
  for (const orderBatch of chunk(orderExternalIds, HINTS_LOOKUP_BATCH)) {
    if (orderBatch.length === 0) continue;
    const inList = orderBatch.map(escSqlString).join(", ");
    await db.execute(sql.raw(`
      UPDATE orders o
      INNER JOIN customers c ON LOWER(o.customerEmail) = LOWER(c.email)
        AND c.email IS NOT NULL AND c.email != ''
      SET o.customerId = c.id
      WHERE o.customerId IS NULL
        AND o.customerEmail IS NOT NULL AND o.customerEmail != ''
        AND o.externalId IN (${inList})
    `));
    await db.execute(sql.raw(`
      UPDATE orders o
      INNER JOIN customers c ON o.customerPhone = c.phone
        AND c.phone IS NOT NULL AND c.phone != ''
      SET o.customerId = c.id
      WHERE o.customerId IS NULL
        AND o.customerPhone IS NOT NULL AND o.customerPhone != ''
        AND o.externalId IN (${inList})
    `));
  }
}

/** Link orphan orders to customers by email, then phone. Optionally scoped to import hints. */
export async function linkOrdersToCustomers(
  db: NonNullable<Awaited<ReturnType<typeof import("./db").getDb>>>,
  hints?: ImportStatsHints,
) {
  const scoped = hints && (
    hints.emails?.length
    || hints.phones?.length
    || hints.orderExternalIds?.length
  );

  if (!scoped) {
    await db.execute(sql.raw(`
      UPDATE orders o
      INNER JOIN customers c ON LOWER(o.customerEmail) = LOWER(c.email)
        AND c.email IS NOT NULL AND c.email != ''
      SET o.customerId = c.id
      WHERE o.customerId IS NULL
        AND o.customerEmail IS NOT NULL AND o.customerEmail != ''
    `));

    await db.execute(sql.raw(`
      UPDATE orders o
      INNER JOIN customers c ON o.customerPhone = c.phone
        AND c.phone IS NOT NULL AND c.phone != ''
      SET o.customerId = c.id
      WHERE o.customerId IS NULL
        AND o.customerPhone IS NOT NULL AND o.customerPhone != ''
    `));
    return;
  }

  if (hints!.orderExternalIds?.length) {
    await linkOrdersByExternalIds(db, hints!.orderExternalIds);
  }

  for (const emailBatch of chunk(filterValidEmails(hints!.emails ?? []), HINTS_LOOKUP_BATCH)) {
    if (emailBatch.length === 0) continue;
    await db.execute(sql.raw(`
      UPDATE orders o
      INNER JOIN customers c ON LOWER(o.customerEmail) = LOWER(c.email)
        AND c.email IS NOT NULL AND c.email != ''
      SET o.customerId = c.id
      WHERE o.customerId IS NULL
        AND o.customerEmail IS NOT NULL AND o.customerEmail != ''
        AND LOWER(o.customerEmail) IN (${emailBatch.map((e) => escSqlString(e.toLowerCase())).join(", ")})
    `));
  }

  for (const phoneBatch of chunk(filterValidPhones(hints!.phones ?? []), HINTS_LOOKUP_BATCH)) {
    if (phoneBatch.length === 0) continue;
    const inList = phoneBatch.map(escSqlString).join(", ");
    await db.execute(sql.raw(`
      UPDATE orders o
      INNER JOIN customers c ON o.customerPhone = c.phone
        AND c.phone IS NOT NULL AND c.phone != ''
      SET o.customerId = c.id
      WHERE o.customerId IS NULL
        AND o.customerPhone IS NOT NULL AND o.customerPhone != ''
        AND o.customerPhone IN (${inList})
    `));
  }
}

/** Resolve customer IDs for stats refresh. Order imports use order numbers only to avoid email/phone over-matching. */
export async function resolveCustomerIdsFromHints(
  db: NonNullable<Awaited<ReturnType<typeof import("./db").getDb>>>,
  hints: ImportStatsHints,
): Promise<number[]> {
  const ids = new Set<number>();
  for (const id of hints.customerIds ?? []) {
    if (id > 0) ids.add(id);
  }

  const orderExternalIds = (hints.orderExternalIds ?? [])
    .map((s) => String(s).trim())
    .filter(Boolean);

  if (orderExternalIds.length > 0) {
    for (const orderBatch of chunk(orderExternalIds, HINTS_LOOKUP_BATCH)) {
      const rows = await db
        .select({ customerId: orders.customerId })
        .from(orders)
        .where(inArray(orders.externalId, orderBatch));
      for (const row of rows) {
        if (row.customerId) ids.add(row.customerId);
      }
    }
    console.log(
      `[CustomerStats] Resolved ${ids.size} customer(s) from ${orderExternalIds.length} imported order(s)`,
    );
    return Array.from(ids);
  }

  for (const emailBatch of chunk(filterValidEmails(hints.emails ?? []), HINTS_LOOKUP_BATCH)) {
    if (emailBatch.length === 0) continue;
    const rows = await db
      .select({ id: customers.id })
      .from(customers)
      .where(inArray(customers.email, emailBatch));
    for (const row of rows) ids.add(row.id);
  }

  for (const phoneBatch of chunk(filterValidPhones(hints.phones ?? []), HINTS_LOOKUP_BATCH)) {
    if (phoneBatch.length === 0) continue;
    const rows = await db
      .select({ id: customers.id })
      .from(customers)
      .where(inArray(customers.phone, phoneBatch));
    for (const row of rows) ids.add(row.id);
  }

  return Array.from(ids);
}

async function executeCustomerStatsBatch(
  db: NonNullable<Awaited<ReturnType<typeof import("./db").getDb>>>,
  idBatch: number[],
): Promise<void> {
  const idList = idBatch.join(",");
  const where = `customerId IS NOT NULL AND customerId IN (${idList}) AND ${VALID_ORDER_STATS_WHERE}`;

  await db.execute(sql.raw(`
    UPDATE customers c
    INNER JOIN (
      SELECT
        customerId,
        COUNT(*) as totalOrders,
        SUM(CAST(NULLIF(TRIM(total), '') AS DECIMAL(12,2))) as totalSpent,
        MAX(NULLIF(TRIM(orderDate), '')) as lastPurchaseDate,
        MAX(NULLIF(TRIM(shippedAt), '')) as lastShipmentAt
      FROM orders
      WHERE ${where}
      GROUP BY customerId
    ) o ON c.id = o.customerId
    SET
      c.totalOrders = o.totalOrders,
      c.totalSpent = o.totalSpent,
      c.lastPurchaseDate = o.lastPurchaseDate,
      c.lastShipmentAt = o.lastShipmentAt
    WHERE c.id IN (${idList})
  `));

  await db.execute(sql.raw(`
    UPDATE customers c
    INNER JOIN (
      SELECT o1.customerId, NULLIF(TRIM(o1.total), '') as lastAmount
      FROM orders o1
      INNER JOIN (
        SELECT customerId, MAX(NULLIF(TRIM(orderDate), '')) as maxDate
        FROM orders
        WHERE ${where}
        GROUP BY customerId
      ) o2 ON o1.customerId = o2.customerId
        AND NULLIF(TRIM(o1.orderDate), '') = o2.maxDate
      WHERE o1.customerId IS NOT NULL AND ${validOrderStatsWhere("o1.")}
    ) latest ON c.id = latest.customerId
    SET c.lastPurchaseAmount = latest.lastAmount
    WHERE c.id IN (${idList})
  `));

  await db.execute(sql.raw(`
    UPDATE customers SET lifecycle = CASE
      WHEN lastShipmentAt >= DATE_SUB(NOW(), INTERVAL 180 DAY) AND totalOrders = 1 THEN 'N'
      WHEN lastShipmentAt >= DATE_SUB(NOW(), INTERVAL 180 DAY) AND totalOrders > 1 THEN 'A'
      WHEN lastShipmentAt >= DATE_SUB(NOW(), INTERVAL 365 DAY) AND lastShipmentAt < DATE_SUB(NOW(), INTERVAL 180 DAY) AND totalOrders > 1 THEN 'S'
      WHEN lastShipmentAt >= DATE_SUB(NOW(), INTERVAL 365 DAY) AND lastShipmentAt < DATE_SUB(NOW(), INTERVAL 180 DAY) AND totalOrders = 1 THEN 'L'
      WHEN lastShipmentAt IS NOT NULL AND lastShipmentAt < DATE_SUB(NOW(), INTERVAL 365 DAY) THEN 'D'
      ELSE 'O'
    END
    WHERE id IN (${idList}) AND totalOrders > 0
  `));

  await db.execute(sql.raw(`
    UPDATE customers c
    JOIN (
      SELECT
        customerId,
        ROUND(AVG(day_diff)) as avg_days
      FROM (
        SELECT
          customerId,
          DATEDIFF(
            NULLIF(TRIM(orderDate), ''),
            LAG(NULLIF(TRIM(orderDate), '')) OVER (PARTITION BY customerId ORDER BY NULLIF(TRIM(orderDate), ''))
          ) as day_diff
        FROM orders
        WHERE ${where}
      ) diffs
      WHERE day_diff IS NOT NULL AND day_diff > 0
      GROUP BY customerId
    ) stats ON c.id = stats.customerId
    SET c.avgRepurchaseDays = stats.avg_days
    WHERE c.id IN (${idList})
  `));

  await db.execute(sql.raw(`
    UPDATE customers c
    LEFT JOIN (
      SELECT DISTINCT customerId FROM orders WHERE ${where}
    ) linked ON c.id = linked.customerId
    SET
      c.totalOrders = 0,
      c.totalSpent = '0',
      c.lastPurchaseDate = NULL,
      c.lastPurchaseAmount = NULL,
      c.lastShipmentAt = NULL,
      c.avgRepurchaseDays = NULL,
      c.lifecycle = 'O'
    WHERE c.id IN (${idList}) AND linked.customerId IS NULL
  `));
}

export async function recalculateCustomerStatsForCustomers(
  db: NonNullable<Awaited<ReturnType<typeof import("./db").getDb>>>,
  customerIds: number[],
): Promise<{ failedBatches: number }> {
  if (!customerIds || customerIds.length === 0) return { failedBatches: 0 };

  const validIds = Array.from(new Set(customerIds.filter(id => id > 0)));
  if (validIds.length === 0) return { failedBatches: 0 };

  const BATCH_SIZE = CUSTOMER_ID_STATS_BATCH;
  const totalBatches = Math.ceil(validIds.length / BATCH_SIZE);
  let failedBatches = 0;

  console.log(`[CustomerStats] 準備更新 ${validIds.length} 個客戶，將分為 ${totalBatches} 批執行...`);

  for (let i = 0; i < validIds.length; i += BATCH_SIZE) {
    const idChunk = validIds.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;

    try {
      console.log(`[CustomerStats] 正在執行第 ${batchNum} 批 (${idChunk.length} 筆)...`);
      await executeCustomerStatsBatch(db, idChunk);
    } catch (error) {
      failedBatches++;
      console.error(
        `[CustomerStats] 第 ${batchNum} 批執行失敗！ID 範圍: ${idChunk[0]} ~ ${idChunk[idChunk.length - 1]}`,
        error,
      );
    }
  }

  console.log(`[CustomerStats] 所有批次更新完成！${failedBatches > 0 ? `（${failedBatches} 批失敗）` : ""}`);
  return { failedBatches };
}

/** Recalculate customer consumption stats. When customerIds provided, only those customers are updated. */
export async function recalculateCustomerStats(
  db: NonNullable<Awaited<ReturnType<typeof import("./db").getDb>>>,
  customerIds?: number[],
): Promise<{ failedBatches: number }> {
  if (customerIds && customerIds.length > 0) {
    return recalculateCustomerStatsForCustomers(db, customerIds);
  }

  const where = `customerId IS NOT NULL AND ${VALID_ORDER_STATS_WHERE}`;

  await db.execute(sql.raw(`
    UPDATE customers c
    INNER JOIN (
      SELECT
        customerId,
        COUNT(*) as totalOrders,
        SUM(CAST(total AS DECIMAL(12,2))) as totalSpent,
        MAX(orderDate) as lastPurchaseDate,
        MAX(shippedAt) as lastShipmentAt
      FROM orders
      WHERE ${where}
      GROUP BY customerId
    ) o ON c.id = o.customerId
    SET
      c.totalOrders = o.totalOrders,
      c.totalSpent = o.totalSpent,
      c.lastPurchaseDate = o.lastPurchaseDate,
      c.lastShipmentAt = o.lastShipmentAt
  `));

  await db.execute(sql.raw(`
    UPDATE customers c
    INNER JOIN (
      SELECT o1.customerId, o1.total as lastAmount
      FROM orders o1
      INNER JOIN (
        SELECT customerId, MAX(orderDate) as maxDate
        FROM orders
        WHERE ${where}
        GROUP BY customerId
      ) o2 ON o1.customerId = o2.customerId AND o1.orderDate = o2.maxDate
      WHERE o1.customerId IS NOT NULL AND ${validOrderStatsWhere("o1.")}
    ) latest ON c.id = latest.customerId
    SET c.lastPurchaseAmount = latest.lastAmount
  `));

  await db.execute(sql.raw(`
    UPDATE customers SET lifecycle = CASE
      WHEN lastShipmentAt >= DATE_SUB(NOW(), INTERVAL 180 DAY) AND totalOrders = 1 THEN 'N'
      WHEN lastShipmentAt >= DATE_SUB(NOW(), INTERVAL 180 DAY) AND totalOrders > 1 THEN 'A'
      WHEN lastShipmentAt >= DATE_SUB(NOW(), INTERVAL 365 DAY) AND lastShipmentAt < DATE_SUB(NOW(), INTERVAL 180 DAY) AND totalOrders > 1 THEN 'S'
      WHEN lastShipmentAt >= DATE_SUB(NOW(), INTERVAL 365 DAY) AND lastShipmentAt < DATE_SUB(NOW(), INTERVAL 180 DAY) AND totalOrders = 1 THEN 'L'
      WHEN lastShipmentAt IS NOT NULL AND lastShipmentAt < DATE_SUB(NOW(), INTERVAL 365 DAY) THEN 'D'
      ELSE 'O'
    END
    WHERE totalOrders > 0
  `));

  await db.execute(sql.raw(`
    UPDATE customers c
    JOIN (
      SELECT
        customerId,
        ROUND(AVG(day_diff)) as avg_days
      FROM (
        SELECT
          customerId,
          DATEDIFF(orderDate, LAG(orderDate) OVER (PARTITION BY customerId ORDER BY orderDate)) as day_diff
        FROM orders
        WHERE ${where}
      ) diffs
      WHERE day_diff IS NOT NULL AND day_diff > 0
      GROUP BY customerId
    ) stats ON c.id = stats.customerId
    SET c.avgRepurchaseDays = stats.avg_days
  `));

  await db.execute(sql.raw(`
    UPDATE customers c
    LEFT JOIN (
      SELECT DISTINCT customerId FROM orders WHERE ${where}
    ) linked ON c.id = linked.customerId
    SET
      c.totalOrders = 0,
      c.totalSpent = '0',
      c.lastPurchaseDate = NULL,
      c.lastPurchaseAmount = NULL,
      c.lastShipmentAt = NULL,
      c.avgRepurchaseDays = NULL,
      c.lifecycle = 'O'
    WHERE linked.customerId IS NULL
  `));

  return { failedBatches: 0 };
}

/** Reset all customer consumption stats (e.g. after clearing all orders). */
export async function resetAllCustomerConsumptionStats(
  db: NonNullable<Awaited<ReturnType<typeof import("./db").getDb>>>,
): Promise<void> {
  await db.execute(sql.raw(`
    UPDATE customers SET
      totalOrders = 0,
      totalSpent = '0',
      lastPurchaseDate = NULL,
      lastPurchaseAmount = NULL,
      lastShipmentAt = NULL,
      avgRepurchaseDays = NULL,
      lifecycle = 'O'
  `));
}

/** Link orders and recalculate stats using import hints when available. */
export type StatsRefreshResult = {
  recalculated: number;
  fullRecalc?: boolean;
  warning?: string;
  failedBatches?: number;
};

export async function refreshCustomerStatsAfterImport(
  db: NonNullable<Awaited<ReturnType<typeof import("./db").getDb>>>,
  hints?: ImportStatsHints,
): Promise<StatsRefreshResult> {
  if (hints && hasImportStatsHints(hints)) {
    await linkOrdersToCustomers(db, hints);
    const customerIds = await resolveCustomerIdsFromHints(db, hints);
    if (customerIds.length > 0) {
      console.log(`[CustomerStats] Recalculating stats for ${customerIds.length} affected customers`);
      const { failedBatches } = await recalculateCustomerStats(db, customerIds);
      return {
        recalculated: customerIds.length,
        failedBatches,
        warning: failedBatches > 0
          ? `部分會員統計更新失敗（${failedBatches} 批）`
          : undefined,
      };
    }
    const orderCount = hints.orderExternalIds?.length ?? 0;
    const warning = orderCount > 0
      ? `匯入 ${orderCount} 筆訂單，但無法對應到既有會員，統計未更新`
      : "匯入資料已寫入，但無法對應到既有會員，統計未更新";
    console.warn(`[CustomerStats] ${warning}`, hints);
    return { recalculated: 0, warning };
  }

  console.log("[CustomerStats] No import hints — falling back to full stats recalculation");
  await linkOrdersToCustomers(db);
  await recalculateCustomerStats(db);
  return { recalculated: -1, fullRecalc: true };
}

export { classifyCustomer, calculateRepurchaseDays };
