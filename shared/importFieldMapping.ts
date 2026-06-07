type Row = Record<string, unknown>;

/** 訂單匯出 CSV（含 SKU）標準欄位 — 與 Shopnex 匯出格式一致 */
export const ORDER_IMPORT_COLUMNS = [
  "訂單日期",
  "訂編",
  "顧客",
  "顧客 Email",
  "顧客手機",
  "LINE UID",
  "收件人名",
  "收件人電話",
  "訂單狀態",
  "付款狀態",
  "出貨狀態",
  "寄送方式",
  "訂單金額",
  "付款方式",
  "貨到付款金額",
  "出貨單號",
  "地址",
  "門市名",
  "發票號碼",
  "手機載具",
  "統一編號",
  "抬頭",
  "捐贈碼",
  "顧客備註",
  "出貨日期",
  "SKU",
  "品名",
  "規格",
  "數量",
  "單價",
  "小計",
] as const;

export type OrderImportColumn = (typeof ORDER_IMPORT_COLUMNS)[number];

function hasValue(val: unknown): boolean {
  if (val === null || val === undefined) return false;
  return String(val).trim() !== "";
}

function pickField(row: Row, ...keys: string[]): unknown {
  for (const key of keys) {
    const val = row[key];
    if (hasValue(val)) return val;
  }
  return "";
}

function pickString(row: Row, ...keys: string[]): string {
  const val = pickField(row, ...keys);
  if (val === null || val === undefined) return "";
  return typeof val === "string" ? val.trim() : String(val).trim();
}

function setIfMissing(normalized: Row, row: Row, canonical: string, ...aliases: string[]) {
  if (hasValue(normalized[canonical])) return;
  const val = pickField(row, canonical, ...aliases);
  if (hasValue(val)) normalized[canonical] = val;
}

function buildAddress(row: Row): string {
  const city = pickString(row, "縣市");
  const district = pickString(row, "區域");
  const street = pickString(row, "地址");
  const combined = [city, district, street].filter(Boolean).join("");
  if (combined) return combined;
  return pickString(row, "地址", "收貨地址");
}

/** Map common Shopnex / export column names to canonical customer import field names. */
export function normalizeCustomerImportRow(row: Row): Row {
  const normalized: Row = { ...row };

  setIfMissing(normalized, row, "顧客名稱", "顧客名稱", "顧客姓名", "姓名", "名稱");
  setIfMissing(normalized, row, "電子信箱", "電子信箱", "信箱", "顧客信箱", "Email", "email", "E-mail");
  setIfMissing(normalized, row, "電話", "電話", "手機", "顧客手機", "手機號碼", "行動電話");
  setIfMissing(normalized, row, "註冊時間", "註冊時間", "註冊日期", "注冊日期");
  setIfMissing(normalized, row, "會員標籤", "會員標籤", "標籤");
  setIfMissing(normalized, row, "顧客備註", "顧客備註", "管理員備註");
  setIfMissing(normalized, row, "SF出貨日", "SF出貨日", "最後出貨日期");
  setIfMissing(normalized, row, "收貨人", "收貨人", "收件人姓名", "收件人");
  setIfMissing(normalized, row, "收貨人手機", "收貨人手機", "收件人手機");
  setIfMissing(normalized, row, "收貨人電子郵件", "收貨人電子郵件", "收件人信箱", "收件人電子郵件");

  const address = buildAddress(row);
  if (address) normalized["地址"] = address;

  return normalized;
}

/** Keep only standard order export columns from a CSV/Excel row. */
export function normalizeOrderImportRow(row: Row): Row {
  const normalized: Row = {};
  for (const col of ORDER_IMPORT_COLUMNS) {
    const val = row[col];
    if (hasValue(val)) normalized[col] = val;
  }
  return normalized;
}

export function getOrderNumberFromRow(row: Row): string {
  return pickString(normalizeOrderImportRow(row), "訂編");
}

export function getCustomerIdentityFields(row: Row): { name: string; email: string; phone: string } {
  const normalized = normalizeCustomerImportRow(row);
  const name = pickString(normalized, "顧客名稱");
  const email = pickString(normalized, "電子信箱");
  const phoneRaw = normalized["電話"];
  const phone =
    typeof phoneRaw === "number" ? String(phoneRaw) : pickString(normalized, "電話");

  return { name, email, phone };
}

/** Customer externalId: email first, then phone, then fallback. */
export function getCustomerExternalId(row: Row, fallback: string): string {
  const { email, phone } = getCustomerIdentityFields(row);
  return email || phone || fallback;
}

export function pickOrderShippingAddress(row: Row): string {
  const normalized = normalizeOrderImportRow(row);
  return [pickString(normalized, "地址"), pickString(normalized, "門市名")].filter(Boolean).join(" ").trim();
}

export function isOrderShipped(row: Row, shippedAt: unknown): boolean {
  const normalized = normalizeOrderImportRow(row);
  const statusTexts = [
    pickString(normalized, "出貨狀態"),
    pickString(normalized, "訂單狀態"),
  ];
  return statusTexts.some(isShippedFromText) || !!shippedAt;
}

export function isShippedFromText(statusText: string | undefined): boolean {
  if (!statusText) return false;
  const s = String(statusText).trim();
  return s.includes("已出貨") || s.includes("已送達") || s.includes("完成") || s.includes("已到貨");
}

export function pickOrderString(row: Row, canonical: OrderImportColumn, ...aliases: string[]): string {
  const normalized = normalizeOrderImportRow(row);
  return pickString(normalized, canonical, ...aliases);
}
