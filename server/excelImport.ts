/**
 * Excel Import Service: parse and import customer, order, and product data from Excel files.
 * Maps Shopnex Excel export columns to our DB schema.
 * 
 * Supports background job mode with TRUE batch writes and progress tracking for large imports.
 * Uses bulk INSERT ... ON DUPLICATE KEY UPDATE for 10-50x faster imports.
 */
import { parseExcel as parseExcelAsync, countExcelRows as countExcelRowsAsync } from "./excelUtils";
import { eq, sql } from "drizzle-orm";
import { getDb } from "./db";
import { customers, orders, orderItems, products, syncLogs, importJobs } from "../drizzle/schema";
import { classifyCustomer, calculateRepurchaseDays } from "./sync";
import { clearRawData } from "./clearRawData";
import { refreshCustomerStatsAfterImport, type ImportStatsHints } from "./customerStats";
import {
  getOrderNumberFromRow,
  isOrderShipped,
  normalizeOrderImportRow,
  pickOrderShippingAddress,
  pickOrderString,
  type OrderImportColumn,
} from "../shared/importFieldMapping";

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

type OrderRow = Partial<Record<OrderImportColumn, string | number>>;

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

// ===== Parse Excel Buffer (async wrapper using ExcelJS) =====

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
  if (s.includes("取消") || s.includes("作廢") || s.includes("退貨")) return -1;
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

// ===== Parse rows count from buffer (async using ExcelJS) =====
export async function countExcelRows(buffer: Buffer): Promise<number> {
  return countExcelRowsAsync(buffer);
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
    const rows = await parseExcelAsync<CustomerRow>(buffer);
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
            const address = row["地址"]?.trim() || null;
            const gender = row["性別"]?.trim() || null;
            const mobileCarrier = row["手機載具"]?.trim() || null;
            const taxId = row["統一編號"]?.trim() || null;
            const company = row["公司"]?.trim() || null;

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

            return `(${esc(extId)}, ${esc(name)}, ${esc(email)}, ${esc(phone)}, ${escDate(registeredAt)}, 0, '0', ${esc(birthday)}, ${esc(tags)}, ${esc(memberLevel)}, ${esc(credits)}, ${esc(recipientName)}, ${esc(recipientPhone)}, ${esc(recipientEmail)}, ${esc(notes)}, ${esc(blacklisted)}, ${esc(lineUid)}, ${esc(note1)}, ${esc(note2)}, ${esc(custom1)}, ${esc(custom2)}, ${esc(custom3)}, ${esc(address)}, ${esc(gender)}, ${esc(mobileCarrier)}, ${esc(taxId)}, ${esc(company)}, ${escDate(sfShippedAt)}, ${rawJson})`;
          }).join(",\n");

          const bulkSql = `INSERT INTO customers (externalId, name, email, phone, registeredAt, totalOrders, totalSpent, birthday, tags, memberLevel, credits, recipientName, recipientPhone, recipientEmail, notes, blacklisted, lineUid, note1, note2, custom1, custom2, custom3, address, gender, mobileCarrier, taxId, company, sfShippedAt, rawData)
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
  address = IF(VALUES(address) IS NOT NULL AND VALUES(address) != '', VALUES(address), address),
  gender = IF(VALUES(gender) IS NOT NULL AND VALUES(gender) != '', VALUES(gender), gender),
  mobileCarrier = IF(VALUES(mobileCarrier) IS NOT NULL AND VALUES(mobileCarrier) != '', VALUES(mobileCarrier), mobileCarrier),
  taxId = IF(VALUES(taxId) IS NOT NULL AND VALUES(taxId) != '', VALUES(taxId), taxId),
  company = IF(VALUES(company) IS NOT NULL AND VALUES(company) != '', VALUES(company), company),
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
                address: row["地址"]?.trim() || null,
                gender: row["性別"]?.trim() || null,
                mobileCarrier: row["手機載具"]?.trim() || null,
                taxId: row["統一編號"]?.trim() || null,
                company: row["公司"]?.trim() || null,
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
                  address: row["地址"]?.trim() ? row["地址"].trim() : sql`customers.address`,
                  gender: row["性別"]?.trim() ? row["性別"].trim() : sql`customers.gender`,
                  mobileCarrier: row["手機載具"]?.trim() ? row["手機載具"].trim() : sql`customers.mobileCarrier`,
                  taxId: row["統一編號"]?.trim() ? row["統一編號"].trim() : sql`customers.taxId`,
                  company: row["公司"]?.trim() ? row["公司"].trim() : sql`customers.company`,
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

    // Clear rawData after successful customer import
    await clearRawData(["customers"]);
    console.log(`[ExcelImport] Cleared rawData for customers table`);

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
    const rows = await parseExcelAsync<OrderRow>(buffer);

    const orderMap = new Map<string, OrderRow[]>();
    for (const row of rows) {
      const normalized = normalizeOrderImportRow(row);
      const orderNum = getOrderNumberFromRow(normalized);
      if (!orderNum) continue;
      if (!orderMap.has(orderNum)) {
        orderMap.set(orderNum, []);
      }
      orderMap.get(orderNum)!.push(normalized as OrderRow);
    }

    let ordersProcessed = 0;
    let itemsProcessed = 0;
    let errorCount = 0;
    const orderEntries = Array.from(orderMap.entries());
    const statsHints: ImportStatsHints = {
      customerIds: [],
      emails: [],
      phones: [],
      orderExternalIds: [],
    };

    for (let i = 0; i < orderEntries.length; i += BATCH_SIZE) {
      const batch = orderEntries.slice(i, i + BATCH_SIZE);

      for (const [orderNum, orderRows] of batch) {
        try {
          const firstRow = normalizeOrderImportRow(orderRows[0]);
          const orderDate = parseDate(pickOrderString(firstRow, "訂單日期"));
          const orderStatus = mapOrderStatus(pickOrderString(firstRow, "訂單狀態"));
          const shipped = isOrderShipped(firstRow, parseDate(pickOrderString(firstRow, "出貨日期")));
          const total = parseNum(pickOrderString(firstRow, "訂單金額"));
          const shippedAtDate = parseDate(pickOrderString(firstRow, "出貨日期")) || (shipped ? orderDate : null);

          const custEmail = pickOrderString(firstRow, "顧客 Email") || null;
          const custName = pickOrderString(firstRow, "顧客") || null;
          const custPhone = pickOrderString(firstRow, "顧客手機") || null;

          if (custEmail) statsHints.emails!.push(custEmail);
          if (custPhone) statsHints.phones!.push(custPhone);
          statsHints.orderExternalIds!.push(orderNum);

          let customerExtId: string | null = null;
          if (custEmail) {
            const existingCust = await db.select({ externalId: customers.externalId, id: customers.id })
              .from(customers)
              .where(sql`LOWER(${customers.email}) = LOWER(${custEmail})`)
              .limit(1);
            if (existingCust.length > 0) {
              customerExtId = existingCust[0].externalId;
              if (existingCust[0].id) statsHints.customerIds!.push(existingCust[0].id);
            }
          }

          const paymentStatus = pickOrderString(firstRow, "付款狀態") || null;

          await db.insert(orders).values({
            externalId: orderNum,
            customerExternalId: customerExtId,
            customerName: custName,
            customerEmail: custEmail,
            customerPhone: custPhone,
            orderStatus,
            progress: paymentStatus,
            total: String(total),
            shipmentFee: "0",
            salesRep: null,
            isShipped: shipped,
            shippedAt: shippedAtDate,
            archived: false,
            orderDate,
            recipientName: pickOrderString(firstRow, "收件人名") || null,
            recipientPhone: pickOrderString(firstRow, "收件人電話") || null,
            paymentMethod: pickOrderString(firstRow, "付款方式") || null,
            shippingMethod: pickOrderString(firstRow, "寄送方式") || null,
            shippingAddress: pickOrderShippingAddress(firstRow) || null,
            shipmentNumber: pickOrderString(firstRow, "出貨單號") || null,
            shippingStatus: pickOrderString(firstRow, "出貨狀態") || null,
            orderStatusText: pickOrderString(firstRow, "訂單狀態") || null,
            rawData: firstRow,
          }).onDuplicateKeyUpdate({
            set: {
              orderStatus,
              progress: paymentStatus,
              total: String(total),
              isShipped: shipped,
              shippedAt: shippedAtDate,
              recipientName: pickOrderString(firstRow, "收件人名") || null,
              recipientPhone: pickOrderString(firstRow, "收件人電話") || null,
              paymentMethod: pickOrderString(firstRow, "付款方式") || null,
              shippingMethod: pickOrderString(firstRow, "寄送方式") || null,
              shippingAddress: pickOrderShippingAddress(firstRow) || null,
              shipmentNumber: pickOrderString(firstRow, "出貨單號") || null,
              shippingStatus: pickOrderString(firstRow, "出貨狀態") || null,
              orderStatusText: pickOrderString(firstRow, "訂單狀態") || null,
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
            const normalizedItem = normalizeOrderImportRow(itemRow);
            const productName = pickOrderString(normalizedItem, "品名");
            if (!productName) continue;

            await db.insert(orderItems).values({
              orderId: resolvedOrderId,
              orderExternalId: orderNum,
              productName,
              productSku: pickOrderString(normalizedItem, "SKU") || null,
              productSpec: pickOrderString(normalizedItem, "規格") || null,
              quantity: parseNum(pickOrderString(normalizedItem, "數量")) || 1,
              unitPrice: String(parseNum(pickOrderString(normalizedItem, "單價"))),
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

    await refreshCustomerStatsAfterImport(db, statsHints);

    await db.update(syncLogs).set({
      status: "success",
      recordsProcessed: ordersProcessed + itemsProcessed,
      completedAt: new Date(),
    }).where(eq(syncLogs.id, Number(logId)));

    if (jobId) {
      await completeJob(db, jobId, ordersProcessed, errorCount, { ordersProcessed, itemsProcessed, errorCount });
    }

    // Clear rawData after successful order import
    await clearRawData(["orders"]);
    console.log(`[ExcelImport] Cleared rawData for orders table`);

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
    const rows = await parseExcelAsync<ProductRow>(buffer);
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

    // Clear rawData after successful product import
    await clearRawData(["products"]);
    console.log(`[ExcelImport] Cleared rawData for products table`);

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

// ===== Logistics Excel Import =====

interface LogisticsRow {
  "PayNow物流單號"?: string;
  "配送編號"?: string;
  "物流狀態"?: string;
}

export async function importLogisticsExcel(buffer: Buffer, jobId?: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const rows = await parseExcelAsync<LogisticsRow>(buffer);
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
