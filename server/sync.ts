/**
 * Data sync service: pulls data from Shopnex API and stores in local DB.
 * Computes customer lifecycle classification (NASLDO) and repurchase days.
 */
import { eq, sql } from "drizzle-orm";
import { getDb } from "./db";
import { customers, orders, syncLogs } from "../drizzle/schema";
import { ShopnexAPI } from "./shopnex";

const SIX_MONTHS_MS = 180 * 24 * 60 * 60 * 1000;
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * Classify customer lifecycle based on rules:
 * N: last shipment within 6 months (180d), only 1 shipment in that period
 * A: last shipment within 6 months (180d), 2+ shipments in that period
 * S: last shipment within 6-12 months (180-365d), 2+ shipments in that period
 * L: last shipment within 6-12 months (180-365d), only 1 shipment in that period
 * D: no shipment within 1 year (365d) and not O
 * O: no shipment within 1 year (365d), but registered within 1 year
 *
 * @param lastShipmentAt - The customer's last shipment date
 * @param registeredAt - The customer's registration date
 * @param ordersInSixMonths - Number of shipped orders within 180 days of referenceDate
 * @param ordersInSixToYear - Number of shipped orders between 180-365 days of referenceDate
 * @param referenceDate - The reference date ("today") for calculation, defaults to now
 */
export function classifyCustomer(
  lastShipmentAt: Date | null,
  registeredAt: Date | null,
  ordersInSixMonths: number,
  ordersInSixToYear: number,
  referenceDate?: Date
): "N" | "A" | "S" | "L" | "D" | "O" {
  const refTime = referenceDate ? referenceDate.getTime() : Date.now();
  const sixMonthsAgo = refTime - SIX_MONTHS_MS;
  const oneYearAgo = refTime - ONE_YEAR_MS;

  if (lastShipmentAt) {
    const lastShipTime = lastShipmentAt.getTime();

    // Within 6 months
    if (lastShipTime >= sixMonthsAgo) {
      return ordersInSixMonths > 1 ? "A" : "N";
    }

    // Within 1 year but not within 6 months
    if (lastShipTime >= oneYearAgo) {
      return ordersInSixToYear > 1 ? "S" : "L";
    }
  }

  // No shipment within 1 year (or no shipment at all)
  // Check if O (registered within 1 year)
  if (registeredAt && registeredAt.getTime() >= oneYearAgo) {
    return "O";
  }

  return "D";
}

/**
 * Calculate average repurchase days from order dates
 */
export function calculateRepurchaseDays(orderDates: Date[]): number | null {
  if (orderDates.length < 2) return null;

  const sorted = [...orderDates].sort((a, b) => a.getTime() - b.getTime());
  let totalDays = 0;
  for (let i = 1; i < sorted.length; i++) {
    totalDays += (sorted[i].getTime() - sorted[i - 1].getTime()) / (24 * 60 * 60 * 1000);
  }
  return Math.round(totalDays / (sorted.length - 1));
}

/**
 * Main sync function
 */
export async function syncFromShopnex(apiToken: string, appName: string): Promise<{
  success: boolean;
  customersProcessed: number;
  ordersProcessed: number;
  error?: string;
}> {
  const db = await getDb();
  if (!db) {
    return { success: false, customersProcessed: 0, ordersProcessed: 0, error: "Database not available" };
  }

  // Create sync log
  const [logResult] = await db.insert(syncLogs).values({
    syncType: "full",
    status: "running",
  });
  const logId = logResult.insertId;

  try {
    const api = new ShopnexAPI(apiToken, appName);

    // 1. Sync users
    console.log("[Sync] Fetching users from Shopnex...");
    const rawUsers = await api.getAllUsers();
    console.log(`[Sync] Got ${rawUsers.length} users`);

    let customersProcessed = 0;
    for (const u of rawUsers) {
      const extId = String(u._id || u.id || u.userID || "");
      if (!extId) continue;

      const regDate = u.createdAt ? new Date(u.createdAt) : (u.created_time ? new Date(u.created_time) : null);

      await db.insert(customers).values({
        externalId: extId,
        name: u.name || u.displayName || null,
        email: u.email || null,
        phone: u.phone || null,
        registeredAt: regDate,
        totalOrders: 0,
        totalSpent: "0",
        rawData: u,
      }).onDuplicateKeyUpdate({
        set: {
          name: u.name || u.displayName || null,
          email: u.email || null,
          phone: u.phone || null,
          registeredAt: regDate,
          rawData: u,
        },
      });
      customersProcessed++;
    }

    // 2. Sync orders
    console.log("[Sync] Fetching orders from Shopnex...");
    const rawOrders = await api.getAllOrders();
    console.log(`[Sync] Got ${rawOrders.length} orders`);

    let ordersProcessed = 0;
    for (const o of rawOrders) {
      const extId = String(o._id || o.id || o.cart_token || "");
      if (!extId) continue;

      const orderDate = o.created_time ? new Date(o.created_time) : (o.createdAt ? new Date(o.createdAt) : null);
      const shippedAt = o.shipment_time ? new Date(o.shipment_time) : (o.shipped_at ? new Date(o.shipped_at) : null);
      const custExtId = o.user_id ? String(o.user_id) : (o.customer_id ? String(o.customer_id) : null);

      await db.insert(orders).values({
        externalId: extId,
        cartToken: o.cart_token || null,
        customerExternalId: custExtId,
        customerName: o.name || o.customer_name || null,
        customerEmail: o.email || null,
        customerPhone: o.phone || null,
        orderStatus: typeof o.orderStatus === "number" ? o.orderStatus : (o.order_status ?? 0),
        progress: o.progress || null,
        total: String(o.total || o.order_total || 0),
        shipmentFee: String(o.shipment_fee || 0),
        salesRep: o.sales_rep || o.salesRep || o.staff || null,
        isShipped: !!(shippedAt || o.is_shipment),
        shippedAt: shippedAt,
        archived: !!o.archived,
        orderDate: orderDate,
        rawData: o,
      }).onDuplicateKeyUpdate({
        set: {
          orderStatus: typeof o.orderStatus === "number" ? o.orderStatus : (o.order_status ?? 0),
          progress: o.progress || null,
          total: String(o.total || o.order_total || 0),
          shipmentFee: String(o.shipment_fee || 0),
          salesRep: o.sales_rep || o.salesRep || o.staff || null,
          isShipped: !!(shippedAt || o.is_shipment),
          shippedAt: shippedAt,
          archived: !!o.archived,
          rawData: o,
        },
      });
      ordersProcessed++;
    }

    // 3. Update customer stats & lifecycle
    console.log("[Sync] Updating customer stats and lifecycle...");
    await updateCustomerStats(db);

    // Update sync log
    await db.update(syncLogs)
      .set({
        status: "success",
        recordsProcessed: customersProcessed + ordersProcessed,
        completedAt: new Date(),
      })
      .where(eq(syncLogs.id, Number(logId)));

    console.log(`[Sync] Complete. Customers: ${customersProcessed}, Orders: ${ordersProcessed}`);
    return { success: true, customersProcessed, ordersProcessed };
  } catch (error: any) {
    console.error("[Sync] Error:", error);
    await db.update(syncLogs)
      .set({
        status: "failed",
        errorMessage: error.message || String(error),
        completedAt: new Date(),
      })
      .where(eq(syncLogs.id, Number(logId)));

    return {
      success: false,
      customersProcessed: 0,
      ordersProcessed: 0,
      error: error.message || String(error),
    };
  }
}

/**
 * Update customer aggregate stats from orders table
 */
async function updateCustomerStats(db: NonNullable<Awaited<ReturnType<typeof getDb>>>) {
  // Get all customers
  const allCustomers = await db.select().from(customers);

  for (const cust of allCustomers) {
    // Get orders for this customer
    const custOrders = await db.select().from(orders)
      .where(eq(orders.customerExternalId, cust.externalId));

    // Filter valid completed orders (not cancelled)
    const validOrders = custOrders.filter(o => o.orderStatus !== -1);
    const shippedOrders = validOrders.filter(o => o.isShipped && o.shippedAt);

    const totalOrders = validOrders.length;
    const totalSpent = validOrders.reduce((sum, o) => sum + parseFloat(String(o.total || "0")), 0);

    // Find last shipment date
    let lastShipmentAt: Date | null = null;
    if (shippedOrders.length > 0) {
      const dates = shippedOrders.map(o => o.shippedAt!).sort((a, b) => b.getTime() - a.getTime());
      lastShipmentAt = dates[0];
    }

    // Calculate repurchase days
    const orderDates = validOrders
      .map(o => o.orderDate)
      .filter((d): d is Date => d !== null)
      .sort((a, b) => a.getTime() - b.getTime());
    const avgRepurchaseDays = calculateRepurchaseDays(orderDates);

    // Count shipped orders in time intervals (using current date as reference)
    const now = Date.now();
    const sixMonthsAgo = now - 180 * 24 * 60 * 60 * 1000;
    const oneYearAgo = now - 365 * 24 * 60 * 60 * 1000;
    const ordersInSixMonths = shippedOrders.filter(o => o.shippedAt!.getTime() >= sixMonthsAgo).length;
    const ordersInSixToYear = shippedOrders.filter(o => {
      const t = o.shippedAt!.getTime();
      return t >= oneYearAgo && t < sixMonthsAgo;
    }).length;

    // Classify lifecycle
    const lifecycle = classifyCustomer(lastShipmentAt, cust.registeredAt, ordersInSixMonths, ordersInSixToYear);

    await db.update(customers)
      .set({
        totalOrders,
        totalSpent: String(totalSpent.toFixed(2)),
        lastShipmentAt,
        avgRepurchaseDays,
        lifecycle,
      })
      .where(eq(customers.id, cust.id));
  }
}
