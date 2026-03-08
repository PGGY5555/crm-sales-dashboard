import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, decimal, bigint, json, boolean } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * CRM Customers - synced from Shopnex API
 */
export const customers = mysqlTable("customers", {
  id: int("id").autoincrement().primaryKey(),
  externalId: varchar("externalId", { length: 128 }).notNull().unique(),
  name: varchar("name", { length: 255 }),
  email: varchar("email", { length: 320 }),
  phone: varchar("phone", { length: 64 }),
  registeredAt: timestamp("registeredAt"),
  lastShipmentAt: timestamp("lastShipmentAt"),
  totalOrders: int("totalOrders").default(0).notNull(),
  totalSpent: decimal("totalSpent", { precision: 12, scale: 2 }).default("0").notNull(),
  /** NASLDO classification */
  lifecycle: mysqlEnum("lifecycle", ["N", "A", "S", "L", "D", "O"]).default("O"),
  /** Average repurchase days */
  avgRepurchaseDays: int("avgRepurchaseDays"),
  /** Extended fields for management filters */
  birthday: varchar("birthday", { length: 32 }),
  tags: text("tags"),
  memberLevel: varchar("memberLevel", { length: 64 }),
  credits: decimal("credits", { precision: 12, scale: 2 }).default("0"),
  lastPurchaseDate: timestamp("lastPurchaseDate"),
  lastPurchaseAmount: decimal("lastPurchaseAmount", { precision: 12, scale: 2 }),
  /** Recipient info from most recent order */
  recipientName: varchar("recipientName", { length: 255 }),
  recipientPhone: varchar("recipientPhone", { length: 64 }),
  recipientEmail: varchar("recipientEmail", { length: 320 }),
  /** Customer notes */
  notes: text("notes"),
  /** Blacklisted flag: '是' or '否' */
  blacklisted: varchar("blacklisted", { length: 16 }).default("否"),
  /** Custom notes and fields */
  note1: text("note1"),
  note2: text("note2"),
  custom1: text("custom1"),
  custom2: text("custom2"),
  custom3: text("custom3"),
  /** LINE UID */
  lineUid: varchar("lineUid", { length: 255 }),
  rawData: json("rawData"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Customer = typeof customers.$inferSelect;
export type InsertCustomer = typeof customers.$inferInsert;

/**
 * CRM Orders - synced from Shopnex API
 */
export const orders = mysqlTable("orders", {
  id: int("id").autoincrement().primaryKey(),
  externalId: varchar("externalId", { length: 128 }).notNull().unique(),
  cartToken: varchar("cartToken", { length: 128 }),
  customerId: int("customerId"),
  customerExternalId: varchar("customerExternalId", { length: 128 }),
  customerName: varchar("customerName", { length: 255 }),
  customerEmail: varchar("customerEmail", { length: 320 }),
  customerPhone: varchar("customerPhone", { length: 64 }),
  /** Order status: -1=cancelled, 0=pending, 1=confirmed, 2=completed */
  orderStatus: int("orderStatus").default(0),
  /** Progress: wait, shipping, done, etc. */
  progress: varchar("progress", { length: 64 }),
  total: decimal("total", { precision: 12, scale: 2 }).default("0"),
  shipmentFee: decimal("shipmentFee", { precision: 10, scale: 2 }).default("0"),
  /** Salesperson / channel */
  salesRep: varchar("salesRep", { length: 255 }),
  isShipped: boolean("isShipped").default(false),
  shippedAt: timestamp("shippedAt"),
  archived: boolean("archived").default(false),
  orderDate: timestamp("orderDate"),
  /** Extended fields for management filters */
  recipientName: varchar("recipientName", { length: 255 }),
  recipientPhone: varchar("recipientPhone", { length: 64 }),
  recipientEmail: varchar("recipientEmail", { length: 320 }),
  orderSource: varchar("orderSource", { length: 128 }),
  paymentMethod: varchar("paymentMethod", { length: 128 }),
  shippingMethod: varchar("shippingMethod", { length: 128 }),
  shippingAddress: text("shippingAddress"),
  /** 出貨單號碼 (from order Excel) */
  shipmentNumber: varchar("shipmentNumber", { length: 128 }),
  /** 配送編號 (from logistics Excel) */
  deliveryNumber: varchar("deliveryNumber", { length: 128 }),
  /** 物流狀態 (from logistics Excel) */
  logisticsStatus: varchar("logisticsStatus", { length: 128 }),
  rawData: json("rawData"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Order = typeof orders.$inferSelect;
export type InsertOrder = typeof orders.$inferInsert;

/**
 * Sync log to track CRM data synchronization
 */
export const syncLogs = mysqlTable("syncLogs", {
  id: int("id").autoincrement().primaryKey(),
  syncType: varchar("syncType", { length: 64 }).notNull(),
  status: mysqlEnum("status", ["running", "success", "failed"]).default("running").notNull(),
  recordsProcessed: int("recordsProcessed").default(0),
  errorMessage: text("errorMessage"),
  startedAt: timestamp("startedAt").defaultNow().notNull(),
  completedAt: timestamp("completedAt"),
});

export type SyncLog = typeof syncLogs.$inferSelect;
export type InsertSyncLog = typeof syncLogs.$inferInsert;

/**
 * App settings - stores encrypted API credentials and configuration
 * Only admin users can read/write these settings
 */
export const settings = mysqlTable("settings", {
  id: int("id").autoincrement().primaryKey(),
  key: varchar("key", { length: 128 }).notNull().unique(),
  /** Encrypted value */
  value: text("value").notNull(),
  /** IV for AES decryption */
  iv: varchar("iv", { length: 64 }).notNull(),
  updatedBy: int("updatedBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Setting = typeof settings.$inferSelect;
export type InsertSetting = typeof settings.$inferInsert;

/**
 * Products - synced from Shopnex or imported via Excel
 */
export const products = mysqlTable("products", {
  id: int("id").autoincrement().primaryKey(),
  externalId: varchar("externalId", { length: 128 }).unique(),
  name: varchar("name", { length: 512 }),
  sku: varchar("sku", { length: 128 }),
  barcode: varchar("barcode", { length: 128 }),
  category: varchar("category", { length: 255 }),
  posCategory: varchar("posCategory", { length: 255 }),
  status: varchar("status", { length: 64 }),
  cost: decimal("cost", { precision: 12, scale: 2 }),
  price: decimal("price", { precision: 12, scale: 2 }),
  originalPrice: decimal("originalPrice", { precision: 12, scale: 2 }),
  profit: decimal("profit", { precision: 12, scale: 2 }),
  stockQuantity: int("stockQuantity").default(0),
  supplier: varchar("supplier", { length: 255 }),
  tags: text("tags"),
  salesChannel: varchar("salesChannel", { length: 255 }),
  rawData: json("rawData"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Product = typeof products.$inferSelect;
export type InsertProduct = typeof products.$inferInsert;

/**
 * Order Items - line items for each order
 */
export const orderItems = mysqlTable("orderItems", {
  id: int("id").autoincrement().primaryKey(),
  orderId: int("orderId"),
  orderExternalId: varchar("orderExternalId", { length: 128 }),
  productName: varchar("productName", { length: 512 }),
  productSku: varchar("productSku", { length: 128 }),
  productSpec: varchar("productSpec", { length: 255 }),
  quantity: int("quantity").default(1),
  unitPrice: decimal("unitPrice", { precision: 12, scale: 2 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type OrderItem = typeof orderItems.$inferSelect;
export type InsertOrderItem = typeof orderItems.$inferInsert;

/**
 * User Permissions - fine-grained access control per user
 */
export const userPermissions = mysqlTable("userPermissions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(),
  permissions: json("permissions").notNull(),
  updatedBy: int("updatedBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type UserPermission = typeof userPermissions.$inferSelect;
export type InsertUserPermission = typeof userPermissions.$inferInsert;

/**
 * Audit Logs - records all critical operations for security tracking
 */
export const auditLogs = mysqlTable("auditLogs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId"),
  userName: varchar("userName", { length: 255 }),
  userEmail: varchar("userEmail", { length: 320 }),
  action: varchar("action", { length: 128 }).notNull(),
  category: varchar("category", { length: 64 }).notNull(),
  description: text("description"),
  details: json("details"),
  ipAddress: varchar("ipAddress", { length: 64 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type AuditLog = typeof auditLogs.$inferSelect;
export type InsertAuditLog = typeof auditLogs.$inferInsert;

/**
 * Import Jobs - track background import task status and progress
 */
export const importJobs = mysqlTable("importJobs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  userName: varchar("userName", { length: 255 }),
  fileType: varchar("fileType", { length: 32 }).notNull(), // customers, orders, products, logistics
  fileName: varchar("fileName", { length: 512 }),
  status: mysqlEnum("status", ["pending", "processing", "completed", "failed"]).default("pending").notNull(),
  totalRows: int("totalRows").default(0),
  processedRows: int("processedRows").default(0),
  successRows: int("successRows").default(0),
  errorRows: int("errorRows").default(0),
  errorMessage: text("errorMessage"),
  result: json("result"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  completedAt: timestamp("completedAt"),
});

export type ImportJob = typeof importJobs.$inferSelect;
export type InsertImportJob = typeof importJobs.$inferInsert;
