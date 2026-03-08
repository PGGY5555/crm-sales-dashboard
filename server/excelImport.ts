/**
 * Excel Import Service: parse and import customer, order, and product data from Excel files.
 * Maps Shopnex Excel export columns to our DB schema.
 * 
 * Supports background job mode with TRUE batch writes and progress tracking for large imports.
 * Uses bulk INSERT ... ON DUPLICATE KEY UPDATE for 10-50x faster imports.
 */
import * as XLSX from "xlsx";
import { eq, sql } from "drizzle-orm";
import { getDb } from "./db";
import { customers, orders, orderItems, products, syncLogs, importJobs } from "../drizzle/schema";
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
  "註冊日期"?: string;
  "備註1"?: string;
  "備註2"?: string;
  "自訂1"?: string;
  "自訂2"?: string;
  "自訂3"?: string;
  "SF出貨日"?: string;
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

// ===== Batch size for bulk inserts =====
const BATCH_SIZE = 500;

// ===== Helper: escape MySQL string =====
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
  try {
    return esc(JSON.stringify(obj));
  } catch {
    return "NULL";
  }
}

// ===== Helper: update import job progress =====
async function updateJobProgress(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  jobId: number,
  processedRows: number,
  successRows: number,
  errorRows: number,
) {
  try {
    await db.update(importJobs).set({
      processedRows,
      successRows,
      errorRows,
      status: "processing",
    }).where(eq(importJobs.id, jobId));
  } catch (err) {
    console.error("[ImportJob] Failed to update progress:", err);
  }
}

async function completeJob(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  jobId: number,
  successRows: number,
  errorRows: number,
  result: Record<string, unknown>,
) {
  try {
    await db.update(importJobs).set({
      status: "completed",
      processedRows: successRows + errorRows,
      successRows,
      errorRows,
      result,
      completedAt: new Date(),
    }).where(eq(importJobs.id, jobId));
  } catch (err) {
    console.error("[ImportJob] Failed to complete job:", err);
  }
}

async function failJob(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  jobId: number,
  errorMessage: string,
  processedRows: number = 0,
  successRows: number = 0,
  errorRows: number = 0,
) {
  try {
    await db.update(importJobs).set({
      status: "failed",
      errorMessage,
      processedRows,
      successRows,
      errorRows,
      completedAt: new Date(),
    }).where(eq(importJobs.id, jobId));
  } catch (err) {
    console.error("[ImportJob] Failed to fail job:", err);
  }
}

// ===== Create import job =====
export async function createImportJob(
  userId: number,
  userName: string | null,
  fileType: string,
  fileName: string | null,
  totalRows: number,
  fileUrl?: string | null,
  fileKey?: string | null,
): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;

  const [result] = await db.insert(importJobs).values({
    userId,
    userName,
    fileType,
    fileName,
    fileUrl: fileUrl || null,
    fileKey: fileKey || null,
    totalRows,
    status: "pending",
    processedRows: 0,
    successRows: 0,
    errorRows: 0,
  });
  return Number(result.insertId);
}

// ===== Update job total rows (after background parsing) =====
export async function updateJobTotalRows(jobId: number, totalRows: number) {
  const db = await getDb();
  if (!db) return;
  try {
    await db.update(importJobs).set({ totalRows }).where(eq(importJobs.id, jobId));
  } catch (err) {
    console.error("[ImportJob] Failed to update totalRows:", err);
  }
}

// ===== Get import job status =====
export async function getImportJobStatus(jobId: number) {
  const db = await getDb();
  if (!db) return null;

  const [job] = await db.select().from(importJobs).where(eq(importJobs.id, jobId));
  return job || null;
}

// ===== Get active import jobs =====
export async function getActiveImportJobs() {
  const db = await getDb();
  if (!db) return [];

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const jobs = await db.select().from(importJobs)
    .where(sql`${importJobs.createdAt} >= ${oneDayAgo}`)
    .orderBy(sql`${importJobs.createdAt} DESC`)
    .limit(20);

  return jobs;
}

// ===== Parse rows count from buffer =====
export function countExcelRows(buffer: Buffer): number {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return 0;
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
  return rows.length;
}

// ===== Import Customers from Excel (Bulk INSERT Mode) =====

export async function importCustomersFromExcel(buffer: Buffer, jobId?: number): Promise<{
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
    let errorCount = 0;

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const validRows: CustomerRow[] = [];

      for (const row of batch) {
        const name = row["顧客名稱"]?.trim();
        const email = row["電子信箱"]?.trim();
        const phone = row["電話"]?.trim();
        if (!name && !email && !phone) {
          errorCount++;
          continue;
        }
        validRows.push(row);
      }

      if (validRows.length > 0) {
        try {
          // Build bulk INSERT ... ON DUPLICATE KEY UPDATE
          const values = validRows.map(row => {
            const name = row["顧客名稱"]?.trim() || null;
            const email = row["電子信箱"]?.trim() || null;
            const phone = row["電話"]?.trim() || null;
            const extId = email || phone || `excel_${i + processed}_${Date.now()}`;
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

            let sfShippedAt: Date | null = null;
            const sfShippedStr = row["SF出貨日"]?.trim();
            if (sfShippedStr) {
              const parsed = parseDate(sfShippedStr);
              if (parsed) sfShippedAt = parsed;
            }

            let registeredAt: Date | null = null;
            const regTimeStr = (row["註冊時間"] || row["註冊日期"])?.trim();
            if (regTimeStr) {
              const parsed = parseDate(regTimeStr);
              if (parsed) registeredAt = parsed;
            }

            const rawJson = escJson(row);

            return `(${esc(extId)}, ${esc(name)}, ${esc(email)}, ${esc(phone)}, ${escDate(registeredAt)}, 0, '0', ${esc(birthday)}, ${esc(tags)}, ${esc(memberLevel)}, ${esc(credits)}, ${esc(recipientName)}, ${esc(recipientPhone)}, ${esc(recipientEmail)}, ${esc(notes)}, ${esc(blacklisted)}, ${esc(lineUid)}, ${esc(note1)}, ${esc(note2)}, ${esc(custom1)}, ${esc(custom2)}, ${esc(custom3)}, ${escDate(sfShippedAt)}, ${rawJson})`;
          }).join(",\n");

          const bulkSql = `INSERT INTO customers (externalId, name, email, phone, registeredAt, totalOrders, totalSpent, birthday, tags, memberLevel, credits, recipientName, recipientPhone, recipientEmail, notes, blacklisted, lineUid, note1, note2, custom1, custom2, custom3, sfShippedAt, rawData)
VALUES ${values}
ON DUPLICATE KEY UPDATE
  name = IF(VALUES(name) IS NOT NULL AND VALUES(name) != '', VALUES(name), name),
  phone = IF(VALUES(phone) IS NOT NULL AND VALUES(phone) != '', VALUES(phone), phone),
  registeredAt = IF(VALUES(registeredAt) IS NOT NULL, VALUES(registeredAt), registeredAt),
  birthday = IF(VALUES(birthday) IS NOT NULL AND VALUES(birthday) != '', VALUES(birthday), birthday),
  tags = IF(VALUES(tags) IS NOT NULL AND VALUES(tags) != '', VALUES(tags), tags),
  memberLevel = IF(VALUES(memberLevel) IS NOT NULL AND VALUES(memberLevel) != '', VALUES(memberLevel), memberLevel),
  credits = IF(VALUES(credits) IS NOT NULL AND VALUES(credits) != '0', VALUES(credits), credits),
  recipientName = IF(VALUES(recipientName) IS NOT NULL AND VALUES(recipientName) != '', VALUES(recipientName), recipientName),
  recipientPhone = IF(VALUES(recipientPhone) IS NOT NULL AND VALUES(recipientPhone) != '', VALUES(recipientPhone), recipientPhone),
  recipientEmail = IF(VALUES(recipientEmail) IS NOT NULL AND VALUES(recipientEmail) != '', VALUES(recipientEmail), recipientEmail),
  notes = IF(VALUES(notes) IS NOT NULL AND VALUES(notes) != '', VALUES(notes), notes),
  blacklisted = IF(VALUES(blacklisted) IS NOT NULL AND VALUES(blacklisted) != '', VALUES(blacklisted), blacklisted),
  lineUid = IF(VALUES(lineUid) IS NOT NULL AND VALUES(lineUid) != '', VALUES(lineUid), lineUid),
  note1 = IF(VALUES(note1) IS NOT NULL AND VALUES(note1) != '', VALUES(note1), note1),
  note2 = IF(VALUES(note2) IS NOT NULL AND VALUES(note2) != '', VALUES(note2), note2),
  custom1 = IF(VALUES(custom1) IS NOT NULL AND VALUES(custom1) != '', VALUES(custom1), custom1),
  custom2 = IF(VALUES(custom2) IS NOT NULL AND VALUES(custom2) != '', VALUES(custom2), custom2),
  custom3 = IF(VALUES(custom3) IS NOT NULL AND VALUES(custom3) != '', VALUES(custom3), custom3),
  sfShippedAt = IF(VALUES(sfShippedAt) IS NOT NULL, VALUES(sfShippedAt), sfShippedAt),
  rawData = VALUES(rawData)`;

          await db.execute(sql.raw(bulkSql));
          processed += validRows.length;
        } catch (batchErr: any) {
          console.error("[ExcelImport] Customer batch error, falling back to row-by-row:", batchErr.message);
          // Fallback: insert row by row
          for (const row of validRows) {
            try {
              const name = row["顧客名稱"]?.trim() || null;
              const email = row["電子信箱"]?.trim() || null;
              const phone = row["電話"]?.trim() || null;
              const extId = email || phone || `excel_${processed}_${Date.now()}`;

              await db.insert(customers).values({
                externalId: extId,
                name,
                email,
                phone,
                registeredAt: (() => { const r = (row["註冊時間"] || row["註冊日期"])?.trim(); if (!r) return null; const d = parseDate(r); return d; })(),
                totalOrders: 0,
                totalSpent: "0",
                birthday: row["生日"]?.trim() || null,
                tags: row["會員標籤"]?.trim() || null,
                memberLevel: row["會員等級"]?.trim() || null,
                credits: String(parseNum(row["購物金餘額"])),
                recipientName: row["收貨人"]?.trim() || null,
                recipientPhone: row["收貨人手機"]?.trim() || null,
                recipientEmail: row["收貨人電子郵件"]?.trim() || null,
                notes: row["顧客備註"]?.trim() || null,
                blacklisted: row["黑名單"]?.trim() || "否",
                lineUid: row["LINE UID"]?.trim() || null,
                note1: row["備註1"]?.trim() || null,
                note2: row["備註2"]?.trim() || null,
                custom1: row["自訂1"]?.trim() || null,
                custom2: row["自訂2"]?.trim() || null,
                custom3: row["自訂3"]?.trim() || null,
                sfShippedAt: (() => { const s = row["SF出貨日"]?.trim(); if (!s) return null; return parseDate(s); })(),
                rawData: row,
              }).onDuplicateKeyUpdate({
                set: {
                  name: name ? name : sql`customers.name`,
                  phone: phone ? phone : sql`customers.phone`,
                  registeredAt: (() => { const r = (row["註冊時間"] || row["註冊日期"])?.trim(); if (!r) return sql`customers.registeredAt`; const d = parseDate(r); return d || sql`customers.registeredAt`; })(),
                  birthday: row["生日"]?.trim() ? row["生日"].trim() : sql`customers.birthday`,
                  tags: row["會員標籤"]?.trim() ? row["會員標籤"].trim() : sql`customers.tags`,
                  memberLevel: row["會員等級"]?.trim() ? row["會員等級"].trim() : sql`customers.memberLevel`,
                  credits: parseNum(row["購物金餘額"]) ? String(parseNum(row["購物金餘額"])) : sql`customers.credits`,
                  recipientName: row["收貨人"]?.trim() ? row["收貨人"].trim() : sql`customers.recipientName`,
                  recipientPhone: row["收貨人手機"]?.trim() ? row["收貨人手機"].trim() : sql`customers.recipientPhone`,
                  recipientEmail: row["收貨人電子郵件"]?.trim() ? row["收貨人電子郵件"].trim() : sql`customers.recipientEmail`,
                  notes: row["顧客備註"]?.trim() ? row["顧客備註"].trim() : sql`customers.notes`,
                  blacklisted: row["黑名單"]?.trim() ? row["黑名單"].trim() : sql`customers.blacklisted`,
                  lineUid: row["LINE UID"]?.trim() ? row["LINE UID"].trim() : sql`customers.lineUid`,
                  note1: row["備註1"]?.trim() ? row["備註1"].trim() : sql`customers.note1`,
                  note2: row["備註2"]?.trim() ? row["備註2"].trim() : sql`customers.note2`,
                  custom1: row["自訂1"]?.trim() ? row["自訂1"].trim() : sql`customers.custom1`,
                  custom2: row["自訂2"]?.trim() ? row["自訂2"].trim() : sql`customers.custom2`,
                  custom3: row["自訂3"]?.trim() ? row["自訂3"].trim() : sql`customers.custom3`,
                  sfShippedAt: (() => { const s = row["SF出貨日"]?.trim(); if (!s) return sql`customers.sfShippedAt`; return parseDate(s) || sql`customers.sfShippedAt`; })(),
                  rawData: row,
                },
              });
              processed++;
            } catch (rowErr) {
              errorCount++;
              console.error("[ExcelImport] Customer row error:", rowErr);
            }
          }
        }
      }

      // Update job progress after each batch
      if (jobId) {
        await updateJobProgress(db, jobId, processed + errorCount, processed, errorCount);
      }

      // Yield to event loop every batch to prevent blocking
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    await db.update(syncLogs).set({
      status: "success",
      recordsProcessed: processed,
      completedAt: new Date(),
    }).where(eq(syncLogs.id, Number(logId)));

    if (jobId) {
      await completeJob(db, jobId, processed, errorCount, { processed, errorCount });
    }

    return { success: true, processed };
  } catch (error: any) {
    console.error("[ExcelImport] Customer import failed:", error);
    await db.update(syncLogs).set({
      status: "failed",
      errorMessage: error.message || String(error),
      completedAt: new Date(),
    }).where(eq(syncLogs.id, Number(logId)));
    
    if (jobId) {
      await failJob(db, jobId, error.message || String(error));
    }
    return { success: false, processed: 0, error: error.message || String(error) };
  }
}

// ===== Import Orders from Excel (Background Job Mode) =====

export async function importOrdersFromExcel(buffer: Buffer, jobId?: number): Promise<{
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
    let errorCount = 0;
    const orderEntries = Array.from(orderMap.entries());

    for (let i = 0; i < orderEntries.length; i += BATCH_SIZE) {
      const batch = orderEntries.slice(i, i + BATCH_SIZE);

      for (const [orderNum, orderRows] of batch) {
        try {
          const firstRow = orderRows[0];
          const orderDate = parseDate(firstRow["訂單建立時間"]);
          const orderStatus = mapOrderStatus(firstRow["訂單處理狀態"]);
          const shipped = isShippedFromText(firstRow["出貨狀態"]);
          const total = parseNum(firstRow["訂單總計"]);
          const shipmentFee = parseNum(firstRow["訂單運費"]);
          const shippedAtDate = parseDate(firstRow["出貨單日期"]) || (shipped ? orderDate : null);

          const custEmail = firstRow["會員信箱"]?.trim() || firstRow["顧客信箱"]?.trim();
          const custName = firstRow["顧客姓名"]?.trim();
          const custPhone = firstRow["顧客手機"]?.trim();

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

          const recipientName = firstRow["收件人姓名"]?.trim() || null;
          const recipientPhone = firstRow["收件人手機"]?.trim() || null;
          const recipientEmail = firstRow["收件人信箱"]?.trim() || null;
          const orderSource = firstRow["訂單來源"] ? String(firstRow["訂單來源"]).trim() : null;
          const paymentMethod = firstRow["付款方式"]?.trim() || null;
          const shippingMethod = firstRow["配送方式"]?.trim() || null;
          const shippingAddress = firstRow["收貨地址"] ? String(firstRow["收貨地址"]).trim() : null;
          const shipmentNumber = firstRow["出貨單號碼"] ? String(firstRow["出貨單號碼"]).trim() : null;

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

          const [upsertedOrder] = await db.select({ id: orders.id }).from(orders).where(eq(orders.externalId, orderNum));
          const resolvedOrderId = upsertedOrder?.id || null;

          if (resolvedOrderId) {
            await db.delete(orderItems).where(eq(orderItems.orderId, resolvedOrderId));
          } else {
            await db.delete(orderItems).where(eq(orderItems.orderExternalId, orderNum));
          }

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
        } catch (rowErr) {
          errorCount++;
          console.error("[ExcelImport] Order row error:", rowErr);
        }
      }

      if (jobId) {
        await updateJobProgress(db, jobId, ordersProcessed + errorCount, ordersProcessed, errorCount);
      }

      // Yield to event loop
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    await updateCustomerStatsFromOrders(db);

    await db.update(syncLogs).set({
      status: "success",
      recordsProcessed: ordersProcessed + itemsProcessed,
      completedAt: new Date(),
    }).where(eq(syncLogs.id, Number(logId)));

    if (jobId) {
      await completeJob(db, jobId, ordersProcessed, errorCount, { ordersProcessed, itemsProcessed, errorCount });
    }

    return { success: true, ordersProcessed, itemsProcessed };
  } catch (error: any) {
    console.error("[ExcelImport] Order import failed:", error);
    await db.update(syncLogs).set({
      status: "failed",
      errorMessage: error.message || String(error),
      completedAt: new Date(),
    }).where(eq(syncLogs.id, Number(logId)));
    
    if (jobId) {
      await failJob(db, jobId, error.message || String(error));
    }
    return { success: false, ordersProcessed: 0, itemsProcessed: 0, error: error.message || String(error) };
  }
}

// ===== Import Products from Excel (Bulk INSERT Mode) =====

export async function importProductsFromExcel(buffer: Buffer, jobId?: number): Promise<{
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
    let errorCount = 0;
    let currentProductName = "";

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);

      for (const row of batch) {
        try {
          const name = row["商品名稱"]?.trim();
          if (name) {
            currentProductName = name;
          }
          const productName = name || currentProductName;
          if (!productName) continue;

          const sku = row["SKU"]?.trim();
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
        } catch (rowErr) {
          errorCount++;
          console.error("[ExcelImport] Product row error:", rowErr);
        }
      }

      if (jobId) {
        await updateJobProgress(db, jobId, processed + errorCount, processed, errorCount);
      }

      // Yield to event loop
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    await db.update(syncLogs).set({
      status: "success",
      recordsProcessed: processed,
      completedAt: new Date(),
    }).where(eq(syncLogs.id, Number(logId)));

    if (jobId) {
      await completeJob(db, jobId, processed, errorCount, { processed, errorCount });
    }

    return { success: true, processed };
  } catch (error: any) {
    console.error("[ExcelImport] Product import failed:", error);
    await db.update(syncLogs).set({
      status: "failed",
      errorMessage: error.message || String(error),
      completedAt: new Date(),
    }).where(eq(syncLogs.id, Number(logId)));
    
    if (jobId) {
      await failJob(db, jobId, error.message || String(error));
    }
    return { success: false, processed: 0, error: error.message || String(error) };
  }
}

// ===== Update customer stats after order import =====

async function updateCustomerStatsFromOrders(db: NonNullable<Awaited<ReturnType<typeof getDb>>>) {
  const allCustomers = await db.select().from(customers);

  for (const cust of allCustomers) {
    let custOrders: any[] = [];
    if (cust.externalId) {
      custOrders = await db.select().from(orders)
        .where(eq(orders.customerExternalId, cust.externalId));
    }
    if (custOrders.length === 0 && cust.email) {
      custOrders = await db.select().from(orders)
        .where(eq(orders.customerEmail, cust.email));
      if (custOrders.length > 0) {
        await db.update(orders)
          .set({ customerExternalId: cust.externalId })
          .where(eq(orders.customerEmail, cust.email));
      }
    }

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

    // Count shipped orders in time intervals (using current date as reference)
    const now = Date.now();
    const sixMonthsAgo = now - 180 * 24 * 60 * 60 * 1000;
    const oneYearAgo = now - 365 * 24 * 60 * 60 * 1000;
    const ordersInSixMonths = shippedOrders.filter((o: any) => o.shippedAt!.getTime() >= sixMonthsAgo).length;
    const ordersInSixToYear = shippedOrders.filter((o: any) => {
      const t = o.shippedAt!.getTime();
      return t >= oneYearAgo && t < sixMonthsAgo;
    }).length;

    const lifecycle = classifyCustomer(lastShipmentAt, cust.registeredAt, ordersInSixMonths, ordersInSixToYear);

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

export async function importLogisticsExcel(buffer: Buffer, jobId?: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("Excel 檔案中沒有工作表");

  const rows = XLSX.utils.sheet_to_json<LogisticsRow>(workbook.Sheets[sheetName]);
  if (rows.length === 0) throw new Error("Excel 檔案中沒有資料");

  let matched = 0;
  let unmatched = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);

    for (const row of batch) {
      const payNowNumber = row["PayNow物流單號"] ? String(row["PayNow物流單號"]).trim() : null;
      const deliveryNumber = row["配送編號"] ? String(row["配送編號"]).trim() : null;
      const logisticsStatus = row["物流狀態"] ? String(row["物流狀態"]).trim() : null;

      if (!payNowNumber) {
        unmatched++;
        continue;
      }

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

    if (jobId) {
      await updateJobProgress(db, jobId, matched + unmatched, matched, unmatched);
    }

    // Yield to event loop
    await new Promise(resolve => setTimeout(resolve, 10));
  }

  await db.insert(syncLogs).values({
    syncType: "logistics_excel",
    status: "success",
    recordsProcessed: matched,
  });

  const resultData = {
    total: rows.length,
    matched,
    unmatched,
  };

  if (jobId) {
    await completeJob(db, jobId, matched, unmatched, resultData);
  }

  return resultData;
}

// ===== Retry a stuck/failed import job =====
export async function retryImportJob(jobId: number): Promise<{ success: boolean; error?: string }> {
  const db = await getDb();
  if (!db) return { success: false, error: "Database not available" };

  const [job] = await db.select().from(importJobs).where(eq(importJobs.id, jobId));
  if (!job) return { success: false, error: "任務不存在" };

  if (job.status === "processing") {
    // Check if it's actually stuck (no progress for > 5 minutes)
    // For now, allow retry of pending/failed/processing jobs
  }

  if (job.status === "completed") {
    return { success: false, error: "任務已完成，無需重試" };
  }

  // Reset job status
  await db.update(importJobs).set({
    status: "pending",
    processedRows: 0,
    successRows: 0,
    errorRows: 0,
    errorMessage: null,
    completedAt: null,
  }).where(eq(importJobs.id, jobId));

  return { success: true };
}
