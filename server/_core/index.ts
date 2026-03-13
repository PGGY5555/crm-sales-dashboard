import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import multer from "multer";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import {
  parseAndStoreJson,
  importCustomersChunk,
  importOrdersChunk,
  importProductsChunk,
  importLogisticsChunk,
} from "../excelImportChunked";
import {
  createImportJob,
  getImportJobStatus,
} from "../excelImport";
import {
  batchImportCustomers,
  batchImportOrders,
  batchImportProducts,
  batchImportLogistics,
} from "../batchImport";
import { storagePut } from "../storage";
import { sdk } from "./sdk";
import { COOKIE_NAME } from "@shared/const";
import { parse as parseCookieHeader } from "cookie";
import { getUserByOpenId, logAudit, checkUserPermission } from "../db";
import { getDb } from "../db";
import type { PermissionKey } from "../../shared/permissions";
import { importJobs, syncLogs } from "../../drizzle/schema";
import { eq, sql } from "drizzle-orm";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

// Helper: verify authenticated session with optional permission check
async function verifyAuthSession(req: express.Request, requiredPermission?: PermissionKey): Promise<{ dbUser: any } | { error: string; status: number }> {
  const cookies = parseCookieHeader(req.headers.cookie || "");
  const sessionCookie = cookies[COOKIE_NAME];
  if (!sessionCookie) return { error: "未登入", status: 401 };

  let session: any;
  try {
    session = await sdk.verifySession(sessionCookie);
  } catch {
    return { error: "登入已過期", status: 401 };
  }
  if (!session) return { error: "登入已過期", status: 401 };

  const dbUser = await getUserByOpenId(session.openId);
  if (!dbUser) return { error: "使用者不存在", status: 403 };

  if (requiredPermission) {
    const hasPermission = await checkUserPermission(dbUser.id, dbUser.role, requiredPermission);
    if (!hasPermission) return { error: "您沒有執行此操作的權限", status: 403 };
  }

  return { dbUser };
}

// Backward-compatible alias
const verifyAdminSession = verifyAuthSession;

async function startServer() {
  const app = express();
  const server = createServer(app);

  // SECURITY: Add security headers
  app.use(helmet({
    contentSecurityPolicy: false, // CSP handled by Vite in dev
    crossOriginEmbedderPolicy: false, // Allow embedding
  }));

  // SECURITY: Rate limiting for API routes
  const apiLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 120, // 120 requests per minute per IP
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "請求過於頻繁，請稍後再試" },
  });
  app.use("/api/", apiLimiter);

  // SECURITY: Stricter rate limit for import/upload endpoints
  const importLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30, // 30 requests per minute
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "匯入請求過於頻繁，請稍後再試" },
  });
  app.use("/api/upload/", importLimiter);
  app.use("/api/import/", importLimiter);

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerOAuthRoutes(app);

  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

  // ===== STEP 1: Upload Excel file to S3 and create import job =====
  app.post("/api/upload/excel", upload.single("file"), async (req, res) => {
    try {
      // Determine required permission based on file type
      const fileType = req.body?.type as string;
      const permissionMap: Record<string, PermissionKey> = {
        customers: "excel_import_customers",
        orders: "excel_import_orders",
        products: "excel_import_products",
        logistics: "excel_import_logistics",
      };
      const requiredPerm = permissionMap[fileType] || "data_sync";
      const auth = await verifyAuthSession(req, requiredPerm);
      if ("error" in auth) {
        res.status(auth.status).json({ error: auth.error });
        return;
      }
      const { dbUser } = auth;

      if (!req.file) {
        res.status(400).json({ error: "請上傳檔案" });
        return;
      }
      if (!fileType || !["customers", "orders", "products", "logistics"].includes(fileType)) {
        res.status(400).json({ error: "請指定檔案類型 (customers, orders, products, logistics)" });
        return;
      }

      const typeLabels: Record<string, string> = {
        customers: '顧客列表', orders: '訂單列表', products: '商品列表', logistics: '訂單物流檔',
      };

      const fileBuffer = req.file.buffer;
      const fileName = req.file.originalname || `upload_${Date.now()}.xlsx`;
      const estimatedRows = Math.max(1, Math.floor(fileBuffer.length / 100));

      // Upload file to S3 first (fast, < 5 seconds)
      const fileKey = `imports/${dbUser.id}/${Date.now()}_${fileName}`;
      let fileUrl = "";
      try {
        const uploadResult = await storagePut(fileKey, fileBuffer, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        fileUrl = uploadResult.url;
      } catch (s3Err: any) {
        console.error("[Excel Upload] S3 upload failed:", s3Err);
        res.status(500).json({ error: "檔案上傳到儲存空間失敗: " + s3Err.message });
        return;
      }

      const jobId = await createImportJob(
        dbUser.id,
        dbUser.name || dbUser.email || 'unknown',
        fileType,
        fileName,
        estimatedRows,
        fileUrl,
        fileKey,
      );

      if (!jobId) {
        res.status(500).json({ error: "無法建立匯入任務" });
        return;
      }

      await logAudit({
        userId: dbUser.id,
        userName: dbUser.name || dbUser.email || 'unknown',
        action: 'excel_import_start',
        category: 'data_sync',
        description: `開始匯入${typeLabels[fileType] || fileType}`,
        details: { jobId, fileName, fileUrl },
      }).catch(() => {});

      res.json({
        success: true,
        backgroundJob: true,
        jobId,
        totalRows: estimatedRows,
        message: `匯入任務已建立，請等待處理`,
      });
    } catch (error: any) {
      console.error("[Excel Upload] Error:", error);
      res.status(500).json({ error: error.message || "上傳失敗" });
    }
  });

  // ===== STEP 2: Process import job ONE CHUNK at a time =====
  // Phase 1 (first call, no jsonUrl): Download Excel → parse → store JSON to S3
  // Phase 2 (subsequent calls, has jsonUrl): Download JSON → bulk INSERT chunk → return
  app.post("/api/import/process", async (req, res) => {
    try {
      const auth = await verifyAuthSession(req, "data_sync");
      if ("error" in auth) {
        res.status(auth.status).json({ error: auth.error });
        return;
      }
      const { dbUser } = auth;

      const { jobId } = req.body;
      if (!jobId) {
        res.status(400).json({ error: "缺少 jobId" });
        return;
      }

      const db = await getDb();
      if (!db) {
        res.status(500).json({ error: "資料庫不可用" });
        return;
      }

      const [job] = await db.select().from(importJobs).where(eq(importJobs.id, jobId));
      if (!job) {
        res.status(404).json({ error: "任務不存在" });
        return;
      }

      if (job.status === "completed") {
        res.json({ status: "completed", done: true, processedRows: job.processedRows, successRows: job.successRows, errorRows: job.errorRows, totalRows: job.totalRows });
        return;
      }
      if (job.status === "failed") {
        res.json({ status: "failed", done: true, message: job.errorMessage || "任務已失敗" });
        return;
      }

      // Mark as processing if still pending
      if (job.status === "pending") {
        await db.update(importJobs).set({ status: "processing" }).where(eq(importJobs.id, jobId));
      }

      if (!job.fileUrl) {
        await db.update(importJobs).set({
          status: "failed",
          errorMessage: "找不到上傳的檔案（fileUrl 為空）",
          completedAt: new Date(),
        }).where(eq(importJobs.id, jobId));
        res.json({ status: "failed", done: true, message: "找不到上傳的檔案" });
        return;
      }

      const typeLabels: Record<string, string> = {
        customers: '顧客列表', orders: '訂單列表', products: '商品列表', logistics: '訂單物流檔',
      };

      try {
        // PHASE 1: If no jsonUrl yet, parse Excel and store JSON to S3
        if (!job.jsonUrl) {
          console.log(`[Import] Job ${jobId}: Phase 1 - parsing Excel and storing JSON...`);
          const parseResult = await parseAndStoreJson(jobId, job.fileUrl, job.fileType);
          res.json({
            status: "processing",
            ...parseResult,
          });
          return;
        }

        // PHASE 2: Process one chunk from JSON
        console.log(`[Import] Job ${jobId}: Phase 2 - importing chunk at offset ${job.processedRows || 0}...`);
        let chunkResult: { done: boolean; processedRows: number; successRows: number; errorRows: number; totalRows: number };
        const offset = job.processedRows || 0;

        switch (job.fileType) {
          case "customers":
            chunkResult = await importCustomersChunk(job.jsonUrl, jobId, offset);
            break;
          case "orders":
            chunkResult = await importOrdersChunk(job.jsonUrl, jobId, offset);
            break;
          case "products":
            chunkResult = await importProductsChunk(job.jsonUrl, jobId, offset);
            break;
          case "logistics":
            chunkResult = await importLogisticsChunk(job.jsonUrl, jobId, offset);
            break;
          default:
            throw new Error("不支援的檔案類型: " + job.fileType);
        }

        if (chunkResult.done) {
          await logAudit({
            userId: dbUser.id,
            userName: dbUser.name || dbUser.email || 'unknown',
            action: 'excel_import_complete',
            category: 'data_sync',
            description: `匯入${typeLabels[job.fileType] || job.fileType}完成`,
            details: { jobId, ...chunkResult },
          }).catch(() => {});
        }

        res.json({
          status: chunkResult.done ? "completed" : "processing",
          ...chunkResult,
        });
      } catch (importErr: any) {
        console.error("[Excel Import Process] Error:", importErr);
        await db.update(importJobs).set({
          status: "failed",
          errorMessage: importErr.message || String(importErr),
          completedAt: new Date(),
        }).where(eq(importJobs.id, jobId));

        await logAudit({
          userId: dbUser.id,
          userName: dbUser.name || dbUser.email || 'unknown',
          action: 'excel_import_failed',
          category: 'data_sync',
          description: `匯入${typeLabels[job.fileType] || job.fileType}失敗: ${importErr.message}`,
          details: { jobId, error: importErr.message },
        }).catch(() => {});

        res.json({ status: "failed", done: true, message: importErr.message || "匯入處理失敗" });
      }
    } catch (error: any) {
      console.error("[Import Process] Error:", error);
      res.status(500).json({ error: error.message || "處理失敗" });
    }
  });

  // ===== NEW: Create import job (no file upload, just metadata) =====
  app.post("/api/import/create-job", async (req, res) => {
    try {
      const ft = req.body?.fileType as string;
      const pm: Record<string, PermissionKey> = { customers: "excel_import_customers", orders: "excel_import_orders", products: "excel_import_products", logistics: "excel_import_logistics" };
      const auth = await verifyAuthSession(req, pm[ft] || "data_sync");
      if ("error" in auth) {
        res.status(auth.status).json({ error: auth.error });
        return;
      }
      const { dbUser } = auth;
      const { fileType, fileName, totalRows } = req.body;

      if (!fileType || !fileName || !totalRows) {
        res.status(400).json({ error: "缺少必要參數" });
        return;
      }

      const jobId = await createImportJob(
        dbUser.id,
        dbUser.name || dbUser.email || 'unknown',
        fileType,
        fileName,
        totalRows,
        '', // no fileUrl needed
        '', // no fileKey needed
      );

      if (!jobId) {
        res.status(500).json({ error: "無法建立匯入任務" });
        return;
      }

      // Mark as processing immediately
      const db = await getDb();
      if (db) {
        await db.update(importJobs).set({ status: "processing" }).where(eq(importJobs.id, jobId));
      }

      await logAudit({
        userId: dbUser.id,
        userName: dbUser.name || dbUser.email || 'unknown',
        action: 'excel_import_start',
        category: 'data_sync',
        description: `開始匯入 ${fileName}`,
        details: { jobId, fileName, fileType, totalRows },
      }).catch(() => {});

      res.json({ success: true, jobId });
    } catch (error: any) {
      console.error("[Create Job] Error:", error);
      res.status(500).json({ error: error.message || "建立任務失敗" });
    }
  });

  // ===== NEW: Batch import (receives JSON rows from frontend) =====
  app.post("/api/import/batch", async (req, res) => {
    try {
      const auth = await verifyAuthSession(req, "data_sync");
      if ("error" in auth) {
        res.status(auth.status).json({ error: auth.error });
        return;
      }

      const { jobId, fileType, batch, offset, totalRows } = req.body;
      if (!jobId || !fileType || !batch || !Array.isArray(batch)) {
        res.status(400).json({ error: "缺少必要參數" });
        return;
      }

      // SECURITY: Limit batch size to prevent memory exhaustion
      const MAX_BATCH_SIZE = 2000;
      if (batch.length > MAX_BATCH_SIZE) {
        res.status(400).json({ error: `單次批次不可超過 ${MAX_BATCH_SIZE} 筆` });
        return;
      }

      let result: { successRows: number; errorRows: number };

      switch (fileType) {
        case "customers":
          result = await batchImportCustomers(batch);
          break;
        case "orders":
          result = await batchImportOrders(batch);
          break;
        case "products":
          result = await batchImportProducts(batch);
          break;
        case "logistics":
          result = await batchImportLogistics(batch);
          break;
        default:
          res.status(400).json({ error: "不支援的檔案類型" });
          return;
      }

      // Update job progress in DB
      const db = await getDb();
      if (db) {
        const [job] = await db.select().from(importJobs).where(eq(importJobs.id, jobId));
        if (job) {
          const newSuccess = (job.successRows || 0) + result.successRows;
          const newError = (job.errorRows || 0) + result.errorRows;
          const newProcessed = newSuccess + newError;
          await db.update(importJobs).set({
            processedRows: newProcessed,
            successRows: newSuccess,
            errorRows: newError,
          }).where(eq(importJobs.id, jobId));
        }
      }

      res.json(result);
    } catch (error: any) {
      console.error("[Batch Import] Error:", error);
      res.status(500).json({ error: error.message || "批次匯入失敗" });
    }
  });

  // ===== NEW: Complete import job =====
  app.post("/api/import/complete", async (req, res) => {
    try {
      const auth = await verifyAuthSession(req, "data_sync");
      if ("error" in auth) {
        res.status(auth.status).json({ error: auth.error });
        return;
      }
      const { dbUser } = auth;
      const { jobId, successRows, errorRows } = req.body;

      if (!jobId) {
        res.status(400).json({ error: "缺少 jobId" });
        return;
      }

      const db = await getDb();
      if (db) {
        await db.update(importJobs).set({
          status: "completed",
          processedRows: (successRows || 0) + (errorRows || 0),
          successRows: successRows || 0,
          errorRows: errorRows || 0,
          completedAt: new Date(),
        }).where(eq(importJobs.id, jobId));

        // Get job info for audit log
        const [job] = await db.select().from(importJobs).where(eq(importJobs.id, jobId));
        if (job) {
          const typeLabels: Record<string, string> = {
            customers: '顧客列表', orders: '訂單列表', products: '商品列表', logistics: '訂單物流檔',
          };
          await db.insert(syncLogs).values({
            syncType: `excel-${job.fileType}`,
            status: "success",
            recordsProcessed: successRows || 0,
          });
          await logAudit({
            userId: dbUser.id,
            userName: dbUser.name || dbUser.email || 'unknown',
            action: 'excel_import_complete',
            category: 'data_sync',
            description: `匯入${typeLabels[job.fileType] || job.fileType}完成`,
            details: { jobId, successRows, errorRows },
          }).catch(() => {});
        }
      }

      // After order import completes, update customer stats
      if (db) {
        const [job] = await db.select().from(importJobs).where(eq(importJobs.id, jobId));
        if (job && (job.fileType === 'orders' || job.fileType === 'logistics')) {
          console.log('[Complete Job] Updating customer stats from orders...');
          try {
            // Use efficient SQL aggregate to update all customer stats at once
            await db.execute(sql.raw(`
              UPDATE customers c
              INNER JOIN (
                SELECT 
                  customerId,
                  COUNT(*) as totalOrders,
                  SUM(CAST(total AS DECIMAL(12,2))) as totalSpent,
                  MAX(orderDate) as lastPurchaseDate,
                  MAX(shippedAt) as lastShipmentAt
                FROM orders
                WHERE customerId IS NOT NULL AND orderStatus != -1 AND (orderStatusText = '已完成' OR orderStatusText IS NULL) AND (shippingStatus IS NULL OR shippingStatus != '已退貨')
                GROUP BY customerId
              ) o ON c.id = o.customerId
              SET 
                c.totalOrders = o.totalOrders,
                c.totalSpent = o.totalSpent,
                c.lastPurchaseDate = o.lastPurchaseDate,
                c.lastShipmentAt = o.lastShipmentAt
            `));

            // Update lastPurchaseAmount separately (need the order with max orderDate)
            await db.execute(sql.raw(`
              UPDATE customers c
              INNER JOIN (
                SELECT o1.customerId, o1.total as lastAmount
                FROM orders o1
                INNER JOIN (
                  SELECT customerId, MAX(orderDate) as maxDate
                  FROM orders
                  WHERE customerId IS NOT NULL AND orderStatus != -1 AND (orderStatusText = '已完成' OR orderStatusText IS NULL) AND (shippingStatus IS NULL OR shippingStatus != '已退貨')
                  GROUP BY customerId
                ) o2 ON o1.customerId = o2.customerId AND o1.orderDate = o2.maxDate
                WHERE o1.orderStatus != -1 AND (o1.orderStatusText = '已完成' OR o1.orderStatusText IS NULL) AND (o1.shippingStatus IS NULL OR o1.shippingStatus != '已退貨')
              ) latest ON c.id = latest.customerId
              SET c.lastPurchaseAmount = latest.lastAmount
            `));

            // Update lifecycle classification (NASLDO)
            await db.execute(sql.raw(`
              UPDATE customers SET lifecycle = CASE
                WHEN lastShipmentAt >= DATE_SUB(NOW(), INTERVAL 180 DAY) AND totalOrders = 1 THEN 'N'
                WHEN lastShipmentAt >= DATE_SUB(NOW(), INTERVAL 180 DAY) AND totalOrders > 1 THEN 'A'
                WHEN lastShipmentAt >= DATE_SUB(NOW(), INTERVAL 365 DAY) AND lastShipmentAt < DATE_SUB(NOW(), INTERVAL 180 DAY) AND totalOrders > 1 THEN 'S'
                WHEN lastShipmentAt >= DATE_SUB(NOW(), INTERVAL 365 DAY) AND lastShipmentAt < DATE_SUB(NOW(), INTERVAL 180 DAY) AND totalOrders = 1 THEN 'L'
                WHEN lastShipmentAt IS NOT NULL AND lastShipmentAt < DATE_SUB(NOW(), INTERVAL 365 DAY) THEN 'D'
                ELSE 'O'
              END
              WHERE totalOrders > 0
            `));

            // Update avgRepurchaseDays
            await db.execute(sql.raw(`
              UPDATE customers c
              JOIN (
                SELECT 
                  customerId,
                  ROUND(AVG(day_diff)) as avg_days
                FROM (
                  SELECT 
                    customerId,
                    DATEDIFF(orderDate, LAG(orderDate) OVER (PARTITION BY customerId ORDER BY orderDate)) as day_diff
                  FROM orders
                  WHERE customerId IS NOT NULL AND orderStatus != -1 AND (orderStatusText = '已完成' OR orderStatusText IS NULL) AND (shippingStatus IS NULL OR shippingStatus != '已退貨')
                ) diffs
                WHERE day_diff IS NOT NULL AND day_diff > 0
                GROUP BY customerId
              ) stats ON c.id = stats.customerId
              SET c.avgRepurchaseDays = stats.avg_days
            `));

            console.log('[Complete Job] Customer stats, lifecycle, and avgRepurchaseDays updated successfully');
          } catch (statsErr: any) {
            console.error('[Complete Job] Stats update error:', statsErr.message);
          }
        }
      }

      res.json({ success: true });
    } catch (error: any) {
      console.error("[Complete Job] Error:", error);
      res.status(500).json({ error: error.message || "完成任務失敗" });
    }
  });

  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
