/**
 * Excel Import Service: parse and import customer, order, and product data from Excel files.
 * Maps Shopnex Excel export columns to our DB schema.
 */
import * as XLSX from "xlsx";
import { eq, sql } from "drizzle-orm";
import { getDb } from "./db";
import { customers, orders, orderItems, products, syncLogs } from "../drizzle/schema";
import { classifyCustomer, calculateRepurchaseDays } from "./sync";

// ===== Column Mappings =====

interface CustomerRow {
  "顧客名稱"?: string;
  "電子信箱"?: string;
  "電話"?: string;
  "生日"?: string;
  "地址"?: string;
  "性別"?: string;
  "收貨人"?: string;
  "收貨人地址"?: string;
  "收貨人電子郵件"?: string;
  "收貨人手機"?: string;
  "顧客備註"?: string;
  "黑名單"?: string;
  "會員標籤"?: string;
  "LINE UID"?: string;
  "FB UID"?: string;
  "購物金餘額"?: number;
  "會員等級"?: string;
  "舊站累積消費"?: number;
  "紅利點數餘額"?: number;
  "手機載具"?: string;
  "統一編號"?: string;
  "公司"?: string;
}

interface OrderRow {
  "訂單編號"?: string;
  "訂單建立時間"?: string;
  "會員信箱"?: string;
  "訂單處理狀態"?: string;
  "付款狀態"?: string;
  "出貨狀態"?: string;
  "訂單小計"?: number;
  "訂單運費"?: number;
  "訂單使用優惠券"?: number;
  "訂單折扣"?: number;
  "訂單使用購物金"?: number;
  "訂單使用點數"?: number;
  "訂單總計"?: number;
  "商品名稱"?: string;
  "商品規格"?: string;
  "商品SKU"?: string;
  "商品購買數量"?: number;
  "商品價格"?: number;
  "顧客姓名"?: string;
  "顧客手機"?: string;
  "顧客信箱"?: string;
  "收件人姓名"?: string;
  "收件人手機"?: string;
  "收件人信箱"?: string;
  "付款方式"?: string;
  "配送方式"?: string;
  "備註"?: string;
  "出貨庫存點"?: string;
  "出貨單日期"?: string;
}

interface ProductRow {
  "商品名稱"?: string;
  "使用狀態"?: string;
  "官網分類"?: string;
  "POS分類"?: string;
  "上架類型"?: string;
  "SKU"?: string;
  "成本"?: number;
  "售價"?: number;
  "原價"?: number;
  "利潤"?: number;
  "庫存"?: number;
  "商品條碼"?: string;
  "商品標籤"?: string;
  "管理員標籤"?: string;
  "供應商"?: string;
  "銷售管道"?: string;
  "商品簡述"?: string;
}

// ===== Parse Excel Buffer =====

function parseExcel<T>(buffer: Buffer): T[] {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const sheet = workbook.Sheets[sheetName];
  return XLSX.utils.sheet_to_json<T>(sheet, { defval: "" });
}

// ===== Parse date string from Excel =====

function parseDate(dateStr: string | number | undefined | null): Date | null {
  if (!dateStr) return null;
  // Handle Excel serial date numbers
  if (typeof dateStr === "number") {
    const excelEpoch = new Date(1899, 11, 30);
    return new Date(excelEpoch.getTime() + dateStr * 86400000);
  }
  const str = String(dateStr).trim();
  if (!str) return null;
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

// ===== Parse number =====

function parseNum(val: string | number | undefined | null): number {
  if (val === null || val === undefined || val === "") return 0;
  const n = typeof val === "number" ? val : parseFloat(String(val).replace(/,/g, ""));
  return isNaN(n) ? 0 : n;
}

// ===== Map order status text to number =====

function mapOrderStatus(statusText: string | undefined): number {
  if (!statusText) return 0;
  const s = String(statusText).trim();
  if (s.includes("取消") || s.includes("作廢")) return -1;
  if (s.includes("完成") || s.includes("已完成")) return 2;
  if (s.includes("確認") || s.includes("處理中")) return 1;
  return 0;
}

// ===== Map shipping status =====

function isShippedFromText(statusText: string | undefined): boolean {
  if (!statusText) return false;
  const s = String(statusText).trim();
  return s.includes("已出貨") || s.includes("已送達") || s.includes("完成") || s.includes("已到貨");
}

// ===== Import Customers from Excel =====

export async function importCustomersFromExcel(buffer: Buffer): Promise<{
  success: boolean;
  processed: number;
  error?: string;
}> {
  const db = await getDb();
  if (!db) return { success: false, processed: 0, error: "Database not available" };

  const [logResult] = await db.insert(syncLogs).values({
    syncType: "excel-customers",
    status: "running",
  });
  const logId = logResult.insertId;

  try {
    const rows = parseExcel<CustomerRow>(buffer);
    let processed = 0;

    for (const row of rows) {
      const name = row["顧客名稱"]?.trim();
      const email = row["電子信箱"]?.trim();
      const phone = row["電話"]?.trim();

      // Use email or phone as unique identifier
      const extId = email || phone || `excel_${processed}_${Date.now()}`;
      if (!name && !email && !phone) continue;

      await db.insert(customers).values({
        externalId: extId,
        name: name || null,
        email: email || null,
        phone: phone || null,
        registeredAt: null, // Excel doesn't have registration date
        totalOrders: 0,
        totalSpent: "0",
        rawData: row,
      }).onDuplicateKeyUpdate({
        set: {
          name: name || null,
          phone: phone || null,
          rawData: row,
        },
      });
      processed++;
    }

    await db.update(syncLogs).set({
      status: "success",
      recordsProcessed: processed,
      completedAt: new Date(),
    }).where(eq(syncLogs.id, Number(logId)));

    return { success: true, processed };
  } catch (error: any) {
    await db.update(syncLogs).set({
      status: "failed",
      errorMessage: error.message || String(error),
      completedAt: new Date(),
    }).where(eq(syncLogs.id, Number(logId)));
    return { success: false, processed: 0, error: error.message || String(error) };
  }
}

// ===== Import Orders from Excel =====

export async function importOrdersFromExcel(buffer: Buffer): Promise<{
  success: boolean;
  ordersProcessed: number;
  itemsProcessed: number;
  error?: string;
}> {
  const db = await getDb();
  if (!db) return { success: false, ordersProcessed: 0, itemsProcessed: 0, error: "Database not available" };

  const [logResult] = await db.insert(syncLogs).values({
    syncType: "excel-orders",
    status: "running",
  });
  const logId = logResult.insertId;

  try {
    const rows = parseExcel<OrderRow>(buffer);

    // Group rows by order number (one order can have multiple line items)
    const orderMap = new Map<string, OrderRow[]>();
    for (const row of rows) {
      const orderNum = String(row["訂單編號"] || "").trim();
      if (!orderNum) continue;
      if (!orderMap.has(orderNum)) {
        orderMap.set(orderNum, []);
      }
      orderMap.get(orderNum)!.push(row);
    }

    let ordersProcessed = 0;
    let itemsProcessed = 0;

    for (const [orderNum, orderRows] of Array.from(orderMap.entries())) {
      const firstRow = orderRows[0];
      const orderDate = parseDate(firstRow["訂單建立時間"]);
      const orderStatus = mapOrderStatus(firstRow["訂單處理狀態"]);
      const shipped = isShippedFromText(firstRow["出貨狀態"]);
      const total = parseNum(firstRow["訂單總計"]);
      const shipmentFee = parseNum(firstRow["訂單運費"]);
      // 讀取「出貨單日期」欄位，若沒有則回退用出貨狀態 + 訂單日期
      const shippedAtDate = parseDate(firstRow["出貨單日期"]) || (shipped ? orderDate : null);

      // Find customer by email
      const custEmail = firstRow["會員信箱"]?.trim() || firstRow["顧客信箱"]?.trim();
      const custName = firstRow["顧客姓名"]?.trim();
      const custPhone = firstRow["顧客手機"]?.trim();

      // Link to customer if email matches
      let customerExtId: string | null = null;
      if (custEmail) {
        const existingCust = await db.select({ externalId: customers.externalId })
          .from(customers)
          .where(eq(customers.email, custEmail))
          .limit(1);
        if (existingCust.length > 0) {
          customerExtId = existingCust[0].externalId;
        }
      }

      // Upsert order
      await db.insert(orders).values({
        externalId: orderNum,
        customerExternalId: customerExtId,
        customerName: custName || null,
        customerEmail: custEmail || null,
        customerPhone: custPhone || null,
        orderStatus,
        progress: firstRow["出貨狀態"]?.trim() || null,
        total: String(total),
        shipmentFee: String(shipmentFee),
        salesRep: null,
        isShipped: shipped,
        shippedAt: shippedAtDate,
        archived: false,
        orderDate,
        rawData: firstRow,
      }).onDuplicateKeyUpdate({
        set: {
          orderStatus,
          progress: firstRow["出貨狀態"]?.trim() || null,
          total: String(total),
          shipmentFee: String(shipmentFee),
          isShipped: shipped,
          shippedAt: shippedAtDate,
          rawData: firstRow,
        },
      });
      ordersProcessed++;

      // Insert order items
      for (const itemRow of orderRows) {
        const productName = itemRow["商品名稱"]?.trim();
        if (!productName) continue;

        await db.insert(orderItems).values({
          orderExternalId: orderNum,
          productName,
          productSku: itemRow["商品SKU"]?.trim() || null,
          productSpec: itemRow["商品規格"]?.trim() || null,
          quantity: parseNum(itemRow["商品購買數量"]) || 1,
          unitPrice: String(parseNum(itemRow["商品價格"])),
        });
        itemsProcessed++;
      }
    }

    // Update customer stats after importing orders
    await updateCustomerStatsFromOrders(db);

    await db.update(syncLogs).set({
      status: "success",
      recordsProcessed: ordersProcessed + itemsProcessed,
      completedAt: new Date(),
    }).where(eq(syncLogs.id, Number(logId)));

    return { success: true, ordersProcessed, itemsProcessed };
  } catch (error: any) {
    await db.update(syncLogs).set({
      status: "failed",
      errorMessage: error.message || String(error),
      completedAt: new Date(),
    }).where(eq(syncLogs.id, Number(logId)));
    return { success: false, ordersProcessed: 0, itemsProcessed: 0, error: error.message || String(error) };
  }
}

// ===== Import Products from Excel =====

export async function importProductsFromExcel(buffer: Buffer): Promise<{
  success: boolean;
  processed: number;
  error?: string;
}> {
  const db = await getDb();
  if (!db) return { success: false, processed: 0, error: "Database not available" };

  const [logResult] = await db.insert(syncLogs).values({
    syncType: "excel-products",
    status: "running",
  });
  const logId = logResult.insertId;

  try {
    const rows = parseExcel<ProductRow>(buffer);
    let processed = 0;
    let currentProductName = "";

    for (const row of rows) {
      // Product name may be empty for sub-spec rows; use the last known product name
      const name = row["商品名稱"]?.trim();
      if (name) {
        currentProductName = name;
      }
      const productName = name || currentProductName;
      if (!productName) continue;

      const sku = row["SKU"]?.trim();
      // Use SKU as unique ID if available, otherwise use name
      const extId = sku || `product_${productName}_${processed}`;

      await db.insert(products).values({
        externalId: extId,
        name: productName,
        sku: sku || null,
        barcode: row["商品條碼"]?.trim() || null,
        category: row["官網分類"]?.trim() || null,
        posCategory: row["POS分類"]?.trim() || null,
        status: row["使用狀態"]?.trim() || null,
        cost: (row["成本"] !== undefined && String(row["成本"]) !== "") ? String(parseNum(row["成本"])) : null,
        price: (row["售價"] !== undefined && String(row["售價"]) !== "") ? String(parseNum(row["售價"])) : null,
        originalPrice: (row["原價"] !== undefined && String(row["原價"]) !== "") ? String(parseNum(row["原價"])) : null,
        profit: (row["利潤"] !== undefined && String(row["利潤"]) !== "") ? String(parseNum(row["利潤"])) : null,
        stockQuantity: parseNum(row["庫存"]) || 0,
        supplier: row["供應商"]?.trim() || null,
        tags: row["商品標籤"]?.trim() || null,
        salesChannel: row["銷售管道"]?.trim() || null,
        rawData: row,
      }).onDuplicateKeyUpdate({
        set: {
          name: productName,
          barcode: row["商品條碼"]?.trim() || null,
          category: row["官網分類"]?.trim() || null,
          posCategory: row["POS分類"]?.trim() || null,
          status: row["使用狀態"]?.trim() || null,
          cost: (row["成本"] !== undefined && String(row["成本"]) !== "") ? String(parseNum(row["成本"])) : null,
          price: (row["售價"] !== undefined && String(row["售價"]) !== "") ? String(parseNum(row["售價"])) : null,
          originalPrice: (row["原價"] !== undefined && String(row["原價"]) !== "") ? String(parseNum(row["原價"])) : null,
          profit: (row["利潤"] !== undefined && String(row["利潤"]) !== "") ? String(parseNum(row["利潤"])) : null,
          stockQuantity: parseNum(row["庫存"]) || 0,
          supplier: row["供應商"]?.trim() || null,
          tags: row["商品標籤"]?.trim() || null,
          salesChannel: row["銷售管道"]?.trim() || null,
          rawData: row,
        },
      });
      processed++;
    }

    await db.update(syncLogs).set({
      status: "success",
      recordsProcessed: processed,
      completedAt: new Date(),
    }).where(eq(syncLogs.id, Number(logId)));

    return { success: true, processed };
  } catch (error: any) {
    await db.update(syncLogs).set({
      status: "failed",
      errorMessage: error.message || String(error),
      completedAt: new Date(),
    }).where(eq(syncLogs.id, Number(logId)));
    return { success: false, processed: 0, error: error.message || String(error) };
  }
}

// ===== Update customer stats after order import =====

async function updateCustomerStatsFromOrders(db: NonNullable<Awaited<ReturnType<typeof getDb>>>) {
  const allCustomers = await db.select().from(customers);

  for (const cust of allCustomers) {
    // Match orders by email or externalId
    let custOrders: any[] = [];
    if (cust.externalId) {
      custOrders = await db.select().from(orders)
        .where(eq(orders.customerExternalId, cust.externalId));
    }
    // Also try matching by email if no orders found by externalId
    if (custOrders.length === 0 && cust.email) {
      custOrders = await db.select().from(orders)
        .where(eq(orders.customerEmail, cust.email));
      // Update customerExternalId for matched orders
      if (custOrders.length > 0) {
        await db.update(orders)
          .set({ customerExternalId: cust.externalId })
          .where(eq(orders.customerEmail, cust.email));
      }
    }

    const validOrders = custOrders.filter(o => o.orderStatus !== -1);
    const shippedOrders = validOrders.filter(o => o.isShipped && o.shippedAt);

    const totalOrders = validOrders.length;
    const totalSpent = validOrders.reduce((sum: number, o: any) => sum + parseFloat(String(o.total || "0")), 0);

    let lastShipmentAt: Date | null = null;
    if (shippedOrders.length > 0) {
      const dates = shippedOrders.map((o: any) => o.shippedAt!).sort((a: Date, b: Date) => b.getTime() - a.getTime());
      lastShipmentAt = dates[0];
    }

    // If no shipped orders, use the latest order date as a fallback for lifecycle calculation
    if (!lastShipmentAt && validOrders.length > 0) {
      const orderDates = validOrders
        .map((o: any) => o.orderDate)
        .filter((d: any): d is Date => d !== null)
        .sort((a: Date, b: Date) => b.getTime() - a.getTime());
      if (orderDates.length > 0) {
        lastShipmentAt = orderDates[0];
      }
    }

    const orderDates = validOrders
      .map((o: any) => o.orderDate)
      .filter((d: any): d is Date => d !== null)
      .sort((a: Date, b: Date) => a.getTime() - b.getTime());
    const avgRepurchaseDays = calculateRepurchaseDays(orderDates);

    const lifecycle = classifyCustomer(lastShipmentAt, totalOrders, cust.registeredAt);

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
