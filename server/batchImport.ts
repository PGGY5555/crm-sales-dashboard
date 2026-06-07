/**
 * Batch Import: Receives pre-parsed JSON rows from the frontend and bulk-inserts them.
 * Each HTTP request handles one batch (~500 rows), completing in 2-5 seconds.
 */
import { sql, eq, inArray } from "drizzle-orm";
import { getDb } from "./db";
import { customers, orders, orderItems, products } from "../drizzle/schema";
import {
  getCustomerExternalId,
  getCustomerIdentityFields,
  isOrderShipped,
  normalizeCustomerImportRow,
  normalizeOrderImportRow,
  pickOrderShippingAddress,
  pickOrderString,
} from "../shared/importFieldMapping";
import type { ImportStatsHints } from "./customerStats";

// Sub-batch size for bulk SQL
const SQL_BATCH = 500;

export type BatchImportResult = {
  successRows: number;
  errorRows: number;
  statsHints?: ImportStatsHints;
};

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
  if (s.includes("取消") || s.includes("作廢") || s.includes("退貨")) return -1;
  if (s.includes("完成") || s.includes("已完成")) return 2;
  if (s.includes("已出貨")) return 2;
  if (s.includes("確認") || s.includes("處理中")) return 1;
  return 0;
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

export async function batchImportCustomers(batch: any[]): Promise<BatchImportResult> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  let successCount = 0;
  let errorCount = 0;
  const statsHints: ImportStatsHints = {
    customerIds: [],
    emails: [],
    phones: [],
  };

  for (let i = 0; i < batch.length; i += SQL_BATCH) {
    const subBatch = batch.slice(i, i + SQL_BATCH);
    const validRows: any[] = [];
    const batchExternalIds: string[] = [];

    for (const rawRow of subBatch) {
      const row = normalizeCustomerImportRow(rawRow);
      const { name, email, phone } = getCustomerIdentityFields(row);
      if (!name && !email && !phone) { errorCount++; continue; }
      validRows.push(row);
      if (email) statsHints.emails!.push(email);
      if (phone) statsHints.phones!.push(phone);
    }

    if (validRows.length > 0) {
      try {
        const values = validRows.map((row, idx) => {
          const { name, email, phone } = getCustomerIdentityFields(row);
          const extId = getCustomerExternalId(row, `excel_${i + idx}_${Date.now()}`);
          batchExternalIds.push(extId);
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
          const address = (typeof row["地址"] === "string" ? row["地址"].trim() : "") || null;
          const gender = (typeof row["性別"] === "string" ? row["性別"].trim() : "") || null;
          const mobileCarrier = (typeof row["手機載具"] === "string" ? row["手機載具"].trim() : "") || null;
          const taxId = (typeof row["統一編號"] === "string" ? row["統一編號"].trim() : typeof row["統一編號"] === "number" ? String(row["統一編號"]) : "") || null;
          const company = (typeof row["公司"] === "string" ? row["公司"].trim() : "") || null;

          let sfShippedAt: Date | null = null;
          const sfShippedRaw = row["SF出貨日"];
          const sfShippedStr = typeof sfShippedRaw === "string" ? sfShippedRaw.trim() : "";
          if (sfShippedStr) {
            const parsed = parseDate(sfShippedStr);
            if (parsed) sfShippedAt = parsed;
          }

          let registeredAt: Date | null = null;
          const regTimeRaw = row["註冊時間"] || row["註冊日期"];
          const regTimeStr = typeof regTimeRaw === "string" ? regTimeRaw.trim() : "";
          if (regTimeStr) {
            const parsed = parseDate(regTimeStr);
            if (parsed) registeredAt = parsed;
          }

          return `(${esc(extId)}, ${esc(name)}, ${esc(email)}, ${esc(phone)}, ${escDate(registeredAt)}, 0, '0', ${esc(birthday)}, ${esc(tags)}, ${esc(memberLevel)}, ${esc(credits)}, ${esc(recipientName)}, ${esc(recipientPhone)}, ${esc(recipientEmail)}, ${esc(notes)}, ${esc(blacklisted)}, ${esc(lineUid)}, ${esc(note1)}, ${esc(note2)}, ${esc(custom1)}, ${esc(custom2)}, ${esc(custom3)}, ${esc(address)}, ${esc(gender)}, ${esc(mobileCarrier)}, ${esc(taxId)}, ${esc(company)}, ${escDate(sfShippedAt)}, ${escJson(row)})`;
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
        successCount += validRows.length;

        for (let j = 0; j < batchExternalIds.length; j += SQL_BATCH) {
          const idSlice = batchExternalIds.slice(j, j + SQL_BATCH);
          const rows = await db
            .select({ id: customers.id })
            .from(customers)
            .where(inArray(customers.externalId, idSlice));
          for (const row of rows) statsHints.customerIds!.push(row.id);
        }
      } catch (batchErr: any) {
        console.error("[BatchImport] Customer batch error:", batchErr.message);
        errorCount += validRows.length;
      }
    }
  }

  return {
    successRows: successCount,
    errorRows: errorCount,
    statsHints: {
      customerIds: Array.from(new Set(statsHints.customerIds ?? [])),
      emails: Array.from(new Set(statsHints.emails ?? [])),
      phones: Array.from(new Set(statsHints.phones ?? [])),
    },
  };
}

async function buildCustomerLookupMaps(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  batch: any[],
) {
  const emails = new Set<string>();
  const phones = new Set<string>();

  for (const entry of batch) {
    if (!entry?.items?.length) continue;
    const firstRow = normalizeOrderImportRow(entry.items[0]);
    const email = pickOrderString(firstRow, "顧客 Email");
    const phone = pickOrderString(firstRow, "顧客手機");
    if (email) emails.add(email);
    if (phone) phones.add(phone);
  }

  const byEmail = new Map<string, number>();
  const byPhone = new Map<string, number>();

  const emailList = Array.from(emails);
  for (let i = 0; i < emailList.length; i += SQL_BATCH) {
    const slice = emailList.slice(i, i + SQL_BATCH);
    const lowerSlice = slice.map((e) => e.toLowerCase());
    const rows = await db
      .select({ id: customers.id, email: customers.email })
      .from(customers)
      .where(sql`LOWER(${customers.email}) IN (${sql.join(lowerSlice.map((e) => sql`${e}`), sql`, `)})`);
    for (const row of rows) {
      if (row.email) byEmail.set(row.email.toLowerCase(), row.id);
    }
  }

  const phoneList = Array.from(phones);
  for (let i = 0; i < phoneList.length; i += SQL_BATCH) {
    const slice = phoneList.slice(i, i + SQL_BATCH);
    const rows = await db
      .select({ id: customers.id, phone: customers.phone })
      .from(customers)
      .where(inArray(customers.phone, slice));
    for (const row of rows) {
      if (row.phone) byPhone.set(row.phone, row.id);
    }
  }

  return { byEmail, byPhone };
}

function resolveCustomerId(
  email: string | null,
  phone: string | null,
  byEmail: Map<string, number>,
  byPhone: Map<string, number>,
): number | null {
  if (email) {
    const byEmailKey = email.toLowerCase();
    if (byEmail.has(byEmailKey)) return byEmail.get(byEmailKey)!;
  }
  if (phone && byPhone.has(phone)) return byPhone.get(phone)!;
  return null;
}

// ===== Batch Order Import =====

export async function batchImportOrders(batch: any[]): Promise<BatchImportResult> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const { byEmail, byPhone } = await buildCustomerLookupMaps(db, batch);

  let successCount = 0;
  let errorCount = 0;
  const statsHints: ImportStatsHints = {
    customerIds: [],
    emails: [],
    phones: [],
    orderExternalIds: [],
  };
  const importedOrderNums: string[] = [];
  const pendingItems: Array<{
    orderNum: string;
    productName: string;
    productSku: string | null;
    productSpec: string | null;
    quantity: number;
    unitPrice: string;
  }> = [];

  for (const entry of batch) {
    const orderNum = entry.orderNum;
    const orderRows = entry.items;
    if (!orderNum || !orderRows?.length) {
      errorCount++;
      continue;
    }

    try {
      const firstRow = normalizeOrderImportRow(orderRows[0]);
      const orderDate = parseDate(pickOrderString(firstRow, "訂單日期"));
      const shippedAt = parseDate(pickOrderString(firstRow, "出貨日期"));
      const totalAmount = parseNum(pickOrderString(firstRow, "訂單金額"));
      const customerEmail = pickOrderString(firstRow, "顧客 Email") || null;
      const customerName = pickOrderString(firstRow, "顧客") || null;
      const customerPhone = pickOrderString(firstRow, "顧客手機") || null;
      const customerId = resolveCustomerId(customerEmail, customerPhone, byEmail, byPhone);
      if (customerId) statsHints.customerIds!.push(customerId);
      if (customerEmail) statsHints.emails!.push(customerEmail);
      if (customerPhone) statsHints.phones!.push(customerPhone);
      statsHints.orderExternalIds!.push(orderNum);
      const statusNum = mapOrderStatus(pickOrderString(firstRow, "訂單狀態"));
      const shipped = isOrderShipped(firstRow, shippedAt);
      const paymentStatus = pickOrderString(firstRow, "付款狀態") || null;

      await db.insert(orders).values({
        externalId: orderNum,
        customerId,
        customerName, customerEmail,
        customerPhone,
        orderDate, shippedAt,
        total: String(totalAmount),
        orderStatus: statusNum,
        isShipped: shipped,
        progress: paymentStatus,
        paymentMethod: pickOrderString(firstRow, "付款方式") || null,
        shippingMethod: pickOrderString(firstRow, "寄送方式") || null,
        recipientName: pickOrderString(firstRow, "收件人名") || null,
        recipientPhone: pickOrderString(firstRow, "收件人電話") || null,
        shippingAddress: pickOrderShippingAddress(firstRow) || null,
        shipmentNumber: pickOrderString(firstRow, "出貨單號") || null,
        shippingStatus: pickOrderString(firstRow, "出貨狀態") || null,
        orderStatusText: pickOrderString(firstRow, "訂單狀態") || null,
        rawData: firstRow,
      }).onDuplicateKeyUpdate({
        set: {
          customerId, customerName, customerEmail, customerPhone,
          orderDate, shippedAt, total: String(totalAmount),
          orderStatus: statusNum, isShipped: shipped,
          progress: paymentStatus,
          paymentMethod: pickOrderString(firstRow, "付款方式") || null,
          shippingMethod: pickOrderString(firstRow, "寄送方式") || null,
          recipientName: pickOrderString(firstRow, "收件人名") || null,
          recipientPhone: pickOrderString(firstRow, "收件人電話") || null,
          shippingAddress: pickOrderShippingAddress(firstRow) || null,
          shipmentNumber: pickOrderString(firstRow, "出貨單號") || null,
          shippingStatus: pickOrderString(firstRow, "出貨狀態") || null,
          orderStatusText: pickOrderString(firstRow, "訂單狀態") || null,
          rawData: firstRow,
        },
      });

      importedOrderNums.push(orderNum);

      for (const itemRow of orderRows) {
        const normalizedItem = normalizeOrderImportRow(itemRow);
        const productName = pickOrderString(normalizedItem, "品名") || null;
        if (!productName) continue;
        pendingItems.push({
          orderNum,
          productName,
          productSku: pickOrderString(normalizedItem, "SKU") || null,
          productSpec: pickOrderString(normalizedItem, "規格") || null,
          quantity: parseNum(pickOrderString(normalizedItem, "數量")) || 1,
          unitPrice: String(parseNum(pickOrderString(normalizedItem, "單價"))),
        });
      }

      successCount++;
    } catch (err: any) {
      console.error(`[BatchImport] Order ${orderNum} error:`, err.message);
      errorCount++;
    }
  }

  if (importedOrderNums.length > 0 && pendingItems.length > 0) {
    for (let i = 0; i < importedOrderNums.length; i += SQL_BATCH) {
      const slice = importedOrderNums.slice(i, i + SQL_BATCH);
      await db.delete(orderItems).where(inArray(orderItems.orderExternalId, slice));
    }

    const orderIdMap = new Map<string, number>();
    for (let i = 0; i < importedOrderNums.length; i += SQL_BATCH) {
      const slice = importedOrderNums.slice(i, i + SQL_BATCH);
      const rows = await db
        .select({ id: orders.id, externalId: orders.externalId })
        .from(orders)
        .where(inArray(orders.externalId, slice));
      for (const row of rows) {
        orderIdMap.set(row.externalId, row.id);
      }
    }

    for (let i = 0; i < pendingItems.length; i += SQL_BATCH) {
      const subBatch = pendingItems.slice(i, i + SQL_BATCH);
      const rowsToInsert = subBatch.flatMap((item) => {
        const orderId = orderIdMap.get(item.orderNum);
        if (!orderId) return [];
        return [{
          orderId,
          orderExternalId: item.orderNum,
          productName: item.productName,
          productSku: item.productSku,
          productSpec: item.productSpec,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
        }];
      });

      if (rowsToInsert.length === 0) continue;

      await db.insert(orderItems).values(rowsToInsert);
    }
  }

  return {
    successRows: successCount,
    errorRows: errorCount,
    statsHints: {
      customerIds: Array.from(new Set(statsHints.customerIds ?? [])),
      emails: Array.from(new Set(statsHints.emails ?? [])),
      phones: Array.from(new Set(statsHints.phones ?? [])),
      orderExternalIds: Array.from(new Set(statsHints.orderExternalIds ?? [])),
    },
  };
}

// ===== Batch Product Import =====

export async function batchImportProducts(batch: any[]): Promise<BatchImportResult> {
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

export async function batchImportLogistics(batch: any[]): Promise<BatchImportResult> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  let successCount = 0;
  let errorCount = 0;
  const shipmentNumbers: string[] = [];

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

      shipmentNumbers.push(payNowNum);
      successCount++;
    } catch (err: any) {
      console.error("[BatchImport] Logistics error:", err.message);
      errorCount++;
    }
  }

  const customerIds: number[] = [];
  for (let i = 0; i < shipmentNumbers.length; i += SQL_BATCH) {
    const slice = shipmentNumbers.slice(i, i + SQL_BATCH);
    const rows = await db
      .select({ customerId: orders.customerId })
      .from(orders)
      .where(inArray(orders.shipmentNumber, slice));
    for (const row of rows) {
      if (row.customerId) customerIds.push(row.customerId);
    }
  }

  return {
    successRows: successCount,
    errorRows: errorCount,
    statsHints: {
      customerIds: Array.from(new Set(customerIds)),
    },
  };
}
