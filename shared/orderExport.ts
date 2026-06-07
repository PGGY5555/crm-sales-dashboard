import { ORDER_IMPORT_COLUMNS } from "./importFieldMapping";

export type OrderExportLineItem = {
  productSku?: string | null;
  productName?: string | null;
  productSpec?: string | null;
  quantity?: number | null;
  unitPrice?: string | null;
};

export type OrderExportSource = {
  externalId?: string | null;
  orderDate?: Date | string | null;
  customerName?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  customerLineUid?: string | null;
  recipientName?: string | null;
  recipientPhone?: string | null;
  orderStatusText?: string | null;
  progress?: string | null;
  shippingStatus?: string | null;
  shippingMethod?: string | null;
  total?: string | null;
  paymentMethod?: string | null;
  shipmentNumber?: string | null;
  shippedAt?: Date | string | null;
  shippingAddress?: string | null;
  rawData?: Record<string, unknown> | null;
  lineItems?: OrderExportLineItem[];
};

function pickRaw(raw: Record<string, unknown> | null | undefined, key: string): string {
  if (!raw) return "";
  const val = raw[key];
  if (val === null || val === undefined) return "";
  return String(val).trim();
}

export function formatOrderExportDateTime(val: Date | string | null | undefined): string {
  if (!val) return "";
  if (typeof val === "string" && /^\d{4}-\d{2}-\d{2}/.test(val.trim())) {
    return val.trim();
  }
  const d = val instanceof Date ? val : new Date(val);
  if (Number.isNaN(d.getTime())) return String(val).trim();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function splitAddress(order: OrderExportSource): { address: string; storeName: string } {
  const rawAddr = pickRaw(order.rawData, "地址");
  const rawStore = pickRaw(order.rawData, "門市名");
  if (rawAddr || rawStore) return { address: rawAddr, storeName: rawStore };
  return { address: order.shippingAddress?.trim() || "", storeName: "" };
}

function computeSubtotal(item?: OrderExportLineItem): string {
  if (!item?.unitPrice || item.quantity == null) return "";
  const amount = Number(item.unitPrice) * Number(item.quantity);
  if (Number.isNaN(amount)) return "";
  return String(amount);
}

type OrderImportColumnValue = (typeof ORDER_IMPORT_COLUMNS)[number];

/** Build one CSV-format row (order header + optional line item). */
export function buildOrderExportRow(
  order: OrderExportSource,
  item?: OrderExportLineItem,
): Record<OrderImportColumnValue, string | number> {
  const raw = order.rawData ?? undefined;
  const { address, storeName } = splitAddress(order);

  const values: Record<string, string | number> = {
    "訂單日期": pickRaw(raw, "訂單日期") || formatOrderExportDateTime(order.orderDate),
    "訂編": order.externalId || "",
    "顧客": order.customerName || pickRaw(raw, "顧客"),
    "顧客 Email": order.customerEmail || pickRaw(raw, "顧客 Email"),
    "顧客手機": order.customerPhone || pickRaw(raw, "顧客手機"),
    "LINE UID": order.customerLineUid || pickRaw(raw, "LINE UID"),
    "收件人名": order.recipientName || pickRaw(raw, "收件人名"),
    "收件人電話": order.recipientPhone || pickRaw(raw, "收件人電話"),
    "訂單狀態": order.orderStatusText || pickRaw(raw, "訂單狀態"),
    "付款狀態": order.progress || pickRaw(raw, "付款狀態"),
    "出貨狀態": order.shippingStatus || pickRaw(raw, "出貨狀態"),
    "寄送方式": order.shippingMethod || pickRaw(raw, "寄送方式"),
    "訂單金額": order.total ?? pickRaw(raw, "訂單金額"),
    "付款方式": order.paymentMethod || pickRaw(raw, "付款方式"),
    "貨到付款金額": pickRaw(raw, "貨到付款金額"),
    "出貨單號": order.shipmentNumber || pickRaw(raw, "出貨單號"),
    "地址": address,
    "門市名": storeName,
    "發票號碼": pickRaw(raw, "發票號碼"),
    "手機載具": pickRaw(raw, "手機載具"),
    "統一編號": pickRaw(raw, "統一編號"),
    "抬頭": pickRaw(raw, "抬頭"),
    "捐贈碼": pickRaw(raw, "捐贈碼"),
    "顧客備註": pickRaw(raw, "顧客備註"),
    "出貨日期": pickRaw(raw, "出貨日期") || formatOrderExportDateTime(order.shippedAt),
    "SKU": item?.productSku || "",
    "品名": item?.productName || "",
    "規格": item?.productSpec || "",
    "數量": item?.quantity ?? "",
    "單價": item?.unitPrice ?? "",
    "小計": item ? computeSubtotal(item) : pickRaw(raw, "小計"),
  };

  const ordered = {} as Record<OrderImportColumnValue, string | number>;
  for (const col of ORDER_IMPORT_COLUMNS) {
    ordered[col] = values[col] ?? "";
  }
  return ordered;
}

/** Flatten orders to CSV-format rows (one row per line item). */
export function flattenOrdersToExportRows(orders: OrderExportSource[]): Record<string, string | number>[] {
  const rows: Record<string, string | number>[] = [];
  for (const order of orders) {
    const items = order.lineItems?.length ? order.lineItems : [undefined];
    for (const item of items) {
      rows.push(buildOrderExportRow(order, item));
    }
  }
  return rows;
}

export { ORDER_IMPORT_COLUMNS as ORDER_EXPORT_COLUMNS };
