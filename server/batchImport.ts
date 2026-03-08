/**
 * Batch Import: Receives pre-parsed JSON rows from the frontend and bulk-inserts them.
 * Each HTTP request handles one batch (~500 rows), completing in 2-5 seconds.
 */
import { sql, eq } from "drizzle-orm";
import { getDb } from "./db";
import { customers, orders, orderItems, products, syncLogs, importJobs } from "../drizzle/schema";
import { classifyCustomer, calculateRepurchaseDays } from "./sync";

// Sub-batch size for bulk SQL
const SQL_BATCH = 500;

// ===== Helpers =====

function parseDate(dateStr: string | number | undefined | null): Date | null {
  if (!dateStr) return null;
  if (typeof dateStr === "number") {
    const excelEpoch = new Date(1899, 11, 30);
    return new Date(excelEpoch.getTime() + dateStr * 86400000);
  }
  const str = String(dateStr).trim();
  if (!str) return null;
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

function parseNum(val: string | number | undefined | null): number {
  if (val === null || val === undefined || val === "") return 0;
  const n = typeof val === "number" ? val : parseFloat(String(val).replace(/,/g, ""));
  return isNaN(n) ? 0 : n;
}

function mapOrderStatus(statusText: string | undefined): number {
  if (!statusText) return 0;
  const s = String(statusText).trim();
  if (s.includes("取消") || s.includes("作廢")) return -1;
  if (s.includes("完成") || s.includes("已完成")) return 2;
  if (s.includes("確認") || s.includes("處理中")) return 1;
  return 0;
}

function isShippedFromText(statusText: string | undefined): boolean {
  if (!statusText) return false;
  const s = String(statusText).trim();
  return s.includes("已出貨") || s.includes("已送達") || s.includes("完成") || s.includes("已到貨");
}

function esc(val: string | null | undefined): string {
  if (val === null || val === undefined) return "NULL";
  return `'${String(val).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

function escDate(d: Date | null): string {
  if (!d) return "NULL";
  return `'${d.toISOString().slice(0, 19).replace("T", " ")}'`;
}

function escJson(obj: any): string {
  if (!obj) return "NULL";
  try { return esc(JSON.stringify(obj)); } catch { return "NULL"; }
}

// ===== Batch Customer Import =====

export async function batchImportCustomers(batch: any[]): Promise<{ successRows: number; errorRows: number }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < batch.length; i += SQL_BATCH) {
    const subBatch = batch.slice(i, i + SQL_BATCH);
    const validRows: any[] = [];

    for (const row of subBatch) {
      const name = row["顧客名稱"]?.trim?.() || (typeof row["顧客名稱"] === "string" ? row["顧客名稱"] : "");
      const email = row["電子信箱"]?.trim?.() || "";
      const phone = row["電話"]?.trim?.() || (typeof row["電話"] === "number" ? String(row["電話"]) : "");
      if (!name && !email && !phone) { errorCount++; continue; }
      validRows.push(row);
    }

    if (validRows.length > 0) {
      try {
        const values = validRows.map((row, idx) => {
          const name = (typeof row["顧客名稱"] === "string" ? row["顧客名稱"].trim() : String(row["顧客名稱"] || "")) || null;
          const email = (typeof row["電子信箱"] === "string" ? row["電子信箱"].trim() : "") || null;
          const phone = (typeof row["電話"] === "string" ? row["電話"].trim() : typeof row["電話"] === "number" ? String(row["電話"]) : "") || null;
          const extId = email || phone || `excel_${i + idx}_${Date.now()}`;
          const birthday = (typeof row["生日"] === "string" ? row["生日"].trim() : "") || null;
          const tags = (typeof row["會員標籤"] === "string" ? row["會員標籤"].trim() : "") || null;
          const memberLevel = (typeof row["會員等級"] === "string" ? row["會員等級"].trim() : "") || null;
          const credits = String(parseNum(row["購物金餘額"]));
          const recipientName = (typeof row["收貨人"] === "string" ? row["收貨人"].trim() : "") || null;
          const recipientPhone = (typeof row["收貨人手機"] === "string" ? row["收貨人手機"].trim() : typeof row["收貨人手機"] === "number" ? String(row["收貨人手機"]) : "") || null;
          const recipientEmail = (typeof row["收貨人電子郵件"] === "string" ? row["收貨人電子郵件"].trim() : "") || null;
          const notes = (typeof row["顧客備註"] === "string" ? row["顧客備註"].trim() : "") || null;
          const blacklisted = (typeof row["黑名單"] === "string" ? row["黑名單"].trim() : "") || "否";
          const lineUid = (typeof row["LINE UID"] === "string" ? row["LINE UID"].trim() : "") || null;
          const note1 = (typeof row["備註1"] === "string" ? row["備註1"].trim() : "") || null;
          const note2 = (typeof row["備註2"] === "string" ? row["備註2"].trim() : "") || null;
          const custom1 = (typeof row["自訂1"] === "string" ? row["自訂1"].trim() : "") || null;
          const custom2 = (typeof row["自訂2"] === "string" ? row["自訂2"].trim() : "") || null;
          const custom3 = (typeof row["自訂3"] === "string" ? row["自訂3"].trim() : "") || null;

          let registeredAt: Date | null = null;
          const regTimeRaw = row["註冊時間"] || row["註冊日期"];
          const regTimeStr = typeof regTimeRaw === "string" ? regTimeRaw.trim() : "";
          if (regTimeStr) {
            const parsed = parseDate(regTimeStr);
            if (parsed) registeredAt = parsed;
          }

          return `(${esc(extId)}, ${esc(name)}, ${esc(email)}, ${esc(phone)}, ${escDate(registeredAt)}, 0, '0', ${esc(birthday)}, ${esc(tags)}, ${esc(memberLevel)}, ${esc(credits)}, ${esc(recipientName)}, ${esc(recipientPhone)}, ${esc(recipientEmail)}, ${esc(notes)}, ${esc(blacklisted)}, ${esc(lineUid)}, ${esc(note1)}, ${esc(note2)}, ${esc(custom1)}, ${esc(custom2)}, ${esc(custom3)}, ${escJson(row)})`;
        }).join(",\n");

        const bulkSql = `INSERT INTO customers (externalId, name, email, phone, registeredAt, totalOrders, totalSpent, birthday, tags, memberLevel, credits, recipientName, recipientPhone, recipientEmail, notes, blacklisted, lineUid, note1, note2, custom1, custom2, custom3, rawData)
VALUES ${values}
ON DUPLICATE KEY UPDATE
  name = VALUES(name), phone = VALUES(phone), registeredAt = VALUES(registeredAt),
  birthday = VALUES(birthday), tags = VALUES(tags), memberLevel = VALUES(memberLevel),
  credits = VALUES(credits), recipientName = VALUES(recipientName),
  recipientPhone = VALUES(recipientPhone), recipientEmail = VALUES(recipientEmail),
  notes = VALUES(notes), blacklisted = VALUES(blacklisted), lineUid = VALUES(lineUid),
  note1 = VALUES(note1), note2 = VALUES(note2), custom1 = VALUES(custom1),
  custom2 = VALUES(custom2), custom3 = VALUES(custom3), rawData = VALUES(rawData)`;

        await db.execute(sql.raw(bulkSql));
        successCount += validRows.length;
      } catch (batchErr: any) {
        console.error("[BatchImport] Customer batch error:", batchErr.message);
        errorCount += validRows.length;
      }
    }
  }

  return { successRows: successCount, errorRows: errorCount };
}

// ===== Batch Order Import =====

export async function batchImportOrders(batch: any[]): Promise<{ successRows: number; errorRows: number }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  let successCount = 0;
  let errorCount = 0;

  for (const entry of batch) {
    const orderNum = entry.orderNum;
    const orderRows = entry.items;
    try {
      const firstRow = orderRows[0];
      const orderDate = parseDate(firstRow["訂單建立時間"]);
      const shippedAt = parseDate(firstRow["出貨單日期"]);
      const totalAmount = parseNum(firstRow["訂單總計"]);
      const customerEmail = firstRow["會員信箱"]?.trim?.() || firstRow["顧客信箱"]?.trim?.() || null;
      const customerName = firstRow["顧客姓名"]?.trim?.() || null;
      const customerPhone = firstRow["顧客手機"]?.trim?.() || (typeof firstRow["顧客手機"] === "number" ? String(firstRow["顧客手機"]) : null);

      let customerId: number | null = null;
      if (customerEmail || customerPhone) {
        const lookupField = customerEmail ? "email" : "phone";
        const lookupVal = customerEmail || customerPhone;
        const [found] = await db.select({ id: customers.id }).from(customers).where(eq(
          lookupField === "email" ? customers.email : customers.phone,
          lookupVal!
        )).limit(1);
        if (found) customerId = found.id;
      }

      const statusNum = mapOrderStatus(firstRow["訂單處理狀態"]);
      const shipped = isShippedFromText(firstRow["出貨狀態"]) || !!shippedAt;

      await db.insert(orders).values({
        externalId: orderNum,
        customerId,
        customerName, customerEmail,
        customerPhone,
        orderDate, shippedAt,
        total: String(totalAmount),
        orderStatus: statusNum,
        isShipped: shipped,
        paymentMethod: firstRow["付款方式"]?.trim?.() || null,
        shippingMethod: firstRow["配送方式"]?.trim?.() || null,
        recipientName: firstRow["收件人姓名"]?.trim?.() || null,
        recipientPhone: firstRow["收件人手機"]?.trim?.() || (typeof firstRow["收件人手機"] === "number" ? String(firstRow["收件人手機"]) : null),
        recipientEmail: firstRow["收件人信箱"]?.trim?.() || null,
        shippingAddress: firstRow["收貨地址"]?.trim?.() || null,
        orderSource: firstRow["訂單來源"]?.trim?.() || null,
        shipmentNumber: firstRow["出貨單號碼"]?.trim?.() || (typeof firstRow["出貨單號碼"] === "number" ? String(firstRow["出貨單號碼"]) : null),
        rawData: firstRow,
      }).onDuplicateKeyUpdate({
        set: {
          customerId, customerName, customerEmail, customerPhone,
          orderDate, shippedAt, total: String(totalAmount),
          orderStatus: statusNum, isShipped: shipped,
          shipmentNumber: firstRow["出貨單號碼"]?.trim?.() || (typeof firstRow["出貨單號碼"] === "number" ? String(firstRow["出貨單號碼"]) : null),
          rawData: firstRow,
        },
      });

      const [insertedOrder] = await db.select({ id: orders.id }).from(orders).where(eq(orders.externalId, orderNum)).limit(1);
      if (insertedOrder) {
        for (const itemRow of orderRows) {
          const productName = itemRow["商品名稱"]?.trim?.() || null;
          if (!productName) continue;
          try {
            await db.insert(orderItems).values({
              orderId: insertedOrder.id,
              orderExternalId: orderNum,
              productName,
              productSku: itemRow["商品SKU"]?.trim?.() || null,
              productSpec: itemRow["商品規格"]?.trim?.() || null,
              quantity: parseNum(itemRow["商品購買數量"]) || 1,
              unitPrice: String(parseNum(itemRow["商品價格"])),
            }).onDuplicateKeyUpdate({
              set: { quantity: parseNum(itemRow["商品購買數量"]) || 1, unitPrice: String(parseNum(itemRow["商品價格"])) },
            });
          } catch {}
        }
      }
      successCount++;
    } catch (err: any) {
      console.error(`[BatchImport] Order ${orderNum} error:`, err.message);
      errorCount++;
    }
  }

  return { successRows: successCount, errorRows: errorCount };
}

// ===== Batch Product Import =====

export async function batchImportProducts(batch: any[]): Promise<{ successRows: number; errorRows: number }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  let successCount = 0;
  let errorCount = 0;

  for (const row of batch) {
    const name = row["商品名稱"]?.trim?.() || null;
    if (!name) { errorCount++; continue; }
    try {
      const sku = row["商品SKU"]?.trim?.() || row["SKU"]?.trim?.() || null;
      const price = String(parseNum(row["商品價格"] || row["價格"]));
      const extId = sku || `product_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await db.insert(products).values({
        externalId: extId, name, sku, price,
        category: row["商品分類"]?.trim?.() || null,
        rawData: row,
      }).onDuplicateKeyUpdate({ set: { name, price, rawData: row } });
      successCount++;
    } catch { errorCount++; }
  }

  return { successRows: successCount, errorRows: errorCount };
}

// ===== Batch Logistics Import =====

export async function batchImportLogistics(batch: any[]): Promise<{ successRows: number; errorRows: number }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  let successCount = 0;
  let errorCount = 0;

  for (const row of batch) {
    try {
      const payNowNum = row["PayNow物流單號"]?.trim?.() || (typeof row["PayNow物流單號"] === "number" ? String(row["PayNow物流單號"]) : null);
      const deliveryNum = row["配送編號"]?.trim?.() || (typeof row["配送編號"] === "number" ? String(row["配送編號"]) : null);
      const logisticsStatus = row["物流狀態"]?.trim?.() || null;

      if (!payNowNum) { errorCount++; continue; }

      await db.update(orders).set({
        deliveryNumber: deliveryNum,
        logisticsStatus,
      }).where(eq(orders.shipmentNumber, payNowNum));

      successCount++;
    } catch (err: any) {
      console.error("[BatchImport] Logistics error:", err.message);
      errorCount++;
    }
  }

  return { successRows: successCount, errorRows: errorCount };
}
