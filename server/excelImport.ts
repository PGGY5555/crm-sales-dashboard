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
  "註冊時間"?: string;
  "備註1"?: string;
  "備註2"?: string;
  "自訂1"?: string;
  "自訂2"?: string;
  "自訂3"?: string;
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
  "訂單來源"?: string;
  "收貨地址"?: string;
  "出貨單號碼"?: string;
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

      const birthday = row["生日"]?.trim() || null;
      const tags = row["會員標籤"]?.trim() || null;
      const memberLevel = row["會員等級"]?.trim() || null;
      const credits = String(parseNum(row["購物金餘額"]));
      const recipientName = row["收貨人"]?.trim() || null;
      const recipientPhone = row["收貨人手機"]?.trim() || null;
      const recipientEmail = row["收貨人電子郵件"]?.trim() || null;
      const notes = row["顧客備註"]?.trim() || null;
      const blacklisted = row["黑名單"]?.trim() || "否";
      const lineUid = row["LINE UID"]?.trim() || null;
      const note1 = row["備註1"]?.trim() || null;
      const note2 = row["備註2"]?.trim() || null;
      const custom1 = row["自訂1"]?.trim() || null;
      const custom2 = row["自訂2"]?.trim() || null;
      const custom3 = row["自訂3"]?.trim() || null;

      // Parse registration date from Excel
      let registeredAt: Date | null = null;
      const regTimeStr = row["註冊時間"]?.trim();
      if (regTimeStr) {
        const parsed = new Date(regTimeStr);
        if (!isNaN(parsed.getTime())) registeredAt = parsed;
      }

      await db.insert(customers).values({
        externalId: extId,
        name: name || null,
        email: email || null,
        phone: phone || null,
        registeredAt,
        totalOrders: 0,
        totalSpent: "0",
        birthday,
        tags,
        memberLevel,
        credits,
        recipientName,
        recipientPhone,
        recipientEmail,
        notes,
        blacklisted,
        lineUid,
        note1,
        note2,
        custom1,
        custom2,
        custom3,
        rawData: row,
      }).onDuplicateKeyUpdate({
        set: {
          name: name || null,
          phone: phone || null,
          registeredAt,
          birthday,
          tags,
          memberLevel,
          credits,
          recipientName,
          recipientPhone,
          recipientEmail,
          notes,
          blacklisted,
          lineUid,
          note1,
          note2,
          custom1,
          custom2,
          custom3,
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

      // Extract extended fields
      const recipientName = firstRow["收件人姓名"]?.trim() || null;
      const recipientPhone = firstRow["收件人手機"]?.trim() || null;
      const recipientEmail = firstRow["收件人信箱"]?.trim() || null;
      const orderSource = firstRow["訂單來源"] ? String(firstRow["訂單來源"]).trim() : null;
      const paymentMethod = firstRow["付款方式"]?.trim() || null;
      const shippingMethod = firstRow["配送方式"]?.trim() || null;
      const shippingAddress = firstRow["收貨地址"] ? String(firstRow["收貨地址"]).trim() : null;
      const shipmentNumber = firstRow["出貨單號碼"] ? String(firstRow["出貨單號碼"]).trim() : null;

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
        recipientName,
        recipientPhone,
        recipientEmail,
        orderSource,
        paymentMethod,
        shippingMethod,
        shippingAddress,
        shipmentNumber,
        rawData: firstRow,
      }).onDuplicateKeyUpdate({
        set: {
          orderStatus,
          progress: firstRow["出貨狀態"]?.trim() || null,
          total: String(total),
          shipmentFee: String(shipmentFee),
          isShipped: shipped,
          shippedAt: shippedAtDate,
          recipientName,
          recipientPhone,
          recipientEmail,
          orderSource,
          paymentMethod,
          shippingMethod,
          shippingAddress,
          shipmentNumber,
          rawData: firstRow,
        },
      });
      ordersProcessed++;

      // Get the orderId for the upserted order
      const [upsertedOrder] = await db.select({ id: orders.id }).from(orders).where(eq(orders.externalId, orderNum));
      const resolvedOrderId = upsertedOrder?.id || null;

      // Delete existing order items for this order (in case of re-import)
      if (resolvedOrderId) {
        await db.delete(orderItems).where(eq(orderItems.orderId, resolvedOrderId));
      } else {
        await db.delete(orderItems).where(eq(orderItems.orderExternalId, orderNum));
      }

      // Insert order items
      for (const itemRow of orderRows) {
        const productName = itemRow["商品名稱"]?.trim();
        if (!productName) continue;

        await db.insert(orderItems).values({
          orderId: resolvedOrderId,
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

    // Backfill customerId on matched orders
    if (custOrders.length > 0) {
      const orderIds = custOrders.map((o: any) => o.id);
      await db.update(orders)
        .set({ customerId: cust.id })
        .where(sql`${orders.id} IN (${sql.join(orderIds.map((id: number) => sql`${id}`), sql`, `)})`);
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

    // Compute lastPurchaseDate and lastPurchaseAmount
    let lastPurchaseDate: Date | null = null;
    let lastPurchaseAmount: number | null = null;
    if (validOrders.length > 0) {
      const sortedByDate = [...validOrders]
        .filter((o: any) => o.orderDate)
        .sort((a: any, b: any) => new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime());
      if (sortedByDate.length > 0) {
        lastPurchaseDate = sortedByDate[0].orderDate;
        lastPurchaseAmount = parseFloat(String(sortedByDate[0].total || "0"));
      }
    }

    await db.update(customers)
      .set({
        totalOrders,
        totalSpent: String(totalSpent.toFixed(2)),
        lastShipmentAt,
        avgRepurchaseDays,
        lifecycle,
        lastPurchaseDate,
        lastPurchaseAmount: lastPurchaseAmount !== null ? String(lastPurchaseAmount.toFixed(2)) : null,
      })
      .where(eq(customers.id, cust.id));
  }
}

// ===== Logistics Excel Import =====

interface LogisticsRow {
  "PayNow物流單號"?: string;
  "配送編號"?: string;
  "物流狀態"?: string;
}

/**
 * Import logistics Excel file.
 * Matches "PayNow物流單號" to orders.shipmentNumber,
 * then writes "配送編號" → deliveryNumber and "物流狀態" → logisticsStatus.
 */
export async function importLogisticsExcel(buffer: Buffer) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("Excel 檔案中沒有工作表");

  const rows = XLSX.utils.sheet_to_json<LogisticsRow>(workbook.Sheets[sheetName]);
  if (rows.length === 0) throw new Error("Excel 檔案中沒有資料");

  let matched = 0;
  let unmatched = 0;

  for (const row of rows) {
    const payNowNumber = row["PayNow物流單號"] ? String(row["PayNow物流單號"]).trim() : null;
    const deliveryNumber = row["配送編號"] ? String(row["配送編號"]).trim() : null;
    const logisticsStatus = row["物流狀態"] ? String(row["物流狀態"]).trim() : null;

    if (!payNowNumber) {
      unmatched++;
      continue;
    }

    // Match by shipmentNumber (出貨單號碼) = PayNow物流單號
    const result = await db.update(orders)
      .set({
        deliveryNumber,
        logisticsStatus,
      })
      .where(eq(orders.shipmentNumber, payNowNumber));

    if (result[0] && (result[0] as any).affectedRows > 0) {
      matched++;
    } else {
      unmatched++;
    }
  }

  // Log the import
  await db.insert(syncLogs).values({
    syncType: "logistics_excel",
    status: "success",
    recordsProcessed: matched,
  });

  return {
    total: rows.length,
    matched,
    unmatched,
  };
}
