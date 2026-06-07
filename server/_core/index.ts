import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic } from "./static";
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
  type BatchImportResult,
} from "../batchImport";
import { mergeImportStatsHints, parseImportStatsHints, refreshCustomerStatsAfterImport } from "../customerStats";
import { parseJobResultField } from "../../shared/importStats";
import { clearRawData } from "../clearRawData";
import { purgeImportJobStorage } from "../clearImportStorage";
import { IMPORT_FILE_TYPE_PERMISSIONS, verifyImportJobAccess } from "../importAccess";
import { storagePut } from "../storage";
import { sdk } from "./sdk";
import { COOKIE_NAME } from "@shared/const";
import { parse as parseCookieHeader } from "cookie";
import { getUserByOpenId, logAudit, checkUserPermission } from "../db";
import { getDb } from "../db";
import type { PermissionKey } from "../../shared/permissions";
import { importJobs, syncLogs } from "../../drizzle/schema";
import { eq, sql } from "drizzle-orm";
import { registerCronRoutes } from "../cronRoutes";

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
  // Cloud Run / reverse proxies terminate TLS and forward X-Forwarded-* headers
  app.set("trust proxy", 1);
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
  registerAuthRoutes(app);

  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

  // ===== STEP 1: Upload Excel file to S3 and create import job =====
  app.post("/api/upload/excel", upload.single("file"), async (req, res) => {
    try {
      // Determine required permission based on file type
      const fileType = req.body?.type as string;
      const requiredPerm = IMPORT_FILE_TYPE_PERMISSIONS[fileType] || "data_sync";
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
        details: { jobId, fileName },
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
      const auth = await verifyAuthSession(req);
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

      const access = await verifyImportJobAccess(jobId, dbUser.id, dbUser.role);
      if (!access.ok) {
        res.status(access.status).json({ error: access.error });
        return;
      }
      const job = access.job;

      const db = await getDb();
      if (!db) {
        res.status(500).json({ error: "資料庫不可用" });
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
          const parseResult = await parseAndStoreJson(
            jobId,
            job.fileUrl,
            job.fileType,
            job.fileName ?? undefined,
            job.fileKey,
          );
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

        await purgeImportJobStorage(jobId).catch(() => {});

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
      const requiredPerm = IMPORT_FILE_TYPE_PERMISSIONS[ft] || "data_sync";
      const auth = await verifyAuthSession(req, requiredPerm);
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
      const auth = await verifyAuthSession(req);
      if ("error" in auth) {
        res.status(auth.status).json({ error: auth.error });
        return;
      }
      const { dbUser } = auth;

      const { jobId, fileType, batch, offset, totalRows } = req.body;
      if (!jobId || !fileType || !batch || !Array.isArray(batch)) {
        res.status(400).json({ error: "缺少必要參數" });
        return;
      }

      const access = await verifyImportJobAccess(jobId, dbUser.id, dbUser.role, fileType);
      if (!access.ok) {
        res.status(access.status).json({ error: access.error });
        return;
      }

      // SECURITY: Limit batch size to prevent memory exhaustion
      const MAX_BATCH_SIZE = 2000;
      if (batch.length > MAX_BATCH_SIZE) {
        res.status(400).json({ error: `單次批次不可超過 ${MAX_BATCH_SIZE} 筆` });
        return;
      }

      let result: BatchImportResult;

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
        const [freshJob] = await db
          .select({ result: importJobs.result, successRows: importJobs.successRows, errorRows: importJobs.errorRows })
          .from(importJobs)
          .where(eq(importJobs.id, jobId));
        if (freshJob) {
          const newSuccess = (freshJob.successRows || 0) + result.successRows;
          const newError = (freshJob.errorRows || 0) + result.errorRows;
          const newProcessed = newSuccess + newError;
          const prevResult = parseJobResultField(freshJob.result);
          const mergedHints = mergeImportStatsHints(
            parseImportStatsHints(prevResult),
            result.statsHints ?? {},
          );
          await db.update(importJobs).set({
            processedRows: newProcessed,
            successRows: newSuccess,
            errorRows: newError,
            result: { ...prevResult, statsHints: mergedHints },
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
      const auth = await verifyAuthSession(req);
      if ("error" in auth) {
        res.status(auth.status).json({ error: auth.error });
        return;
      }
      const { dbUser } = auth;
      const { jobId, successRows, errorRows, statsHints: bodyStatsHints } = req.body;

      if (!jobId) {
        res.status(400).json({ error: "缺少 jobId" });
        return;
      }

      const access = await verifyImportJobAccess(jobId, dbUser.id, dbUser.role);
      if (!access.ok) {
        res.status(access.status).json({ error: access.error });
        return;
      }
      const job = access.job;

      const db = await getDb();
      let statsRefreshed = false;
      let statsRecalculated = 0;
      let statsWarning: string | undefined;
      let statsError: string | undefined;

      if (db) {
        const [freshJob] = await db
          .select({ result: importJobs.result })
          .from(importJobs)
          .where(eq(importJobs.id, jobId));
        const prevResult = parseJobResultField(freshJob?.result);
        const mergedHints = mergeImportStatsHints(
          parseImportStatsHints(prevResult),
          bodyStatsHints ?? {},
        );

        await db.update(importJobs).set({
          status: "completed",
          processedRows: (successRows || 0) + (errorRows || 0),
          successRows: successRows || 0,
          errorRows: errorRows || 0,
          completedAt: new Date(),
          result: { ...prevResult, statsHints: mergedHints },
        }).where(eq(importJobs.id, jobId));

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

        // After import completes, link orders and recalculate customer stats (scoped to affected customers)
        if (job.fileType === "customers" || job.fileType === "orders" || job.fileType === "logistics") {
          console.log(`[Complete Job] Refreshing customer stats (trigger: ${job.fileType})...`);
          try {
            const statsResult = await refreshCustomerStatsAfterImport(db, mergedHints);
            statsRefreshed = true;
            statsRecalculated = statsResult.recalculated;
            statsWarning = statsResult.warning;
            console.log(
              `[Complete Job] Customer stats updated: recalculated=${statsResult.recalculated}, fullRecalc=${!!statsResult.fullRecalc}`,
            );
          } catch (statsErr: any) {
            statsError = statsErr.message || "統計更新失敗";
            console.error("[Complete Job] Stats update error:", statsError);
          }
        }

        const rawDataTables: Array<"customers" | "orders" | "products"> =
          job.fileType === "customers" ? ["customers"]
          : job.fileType === "orders" || job.fileType === "logistics" ? ["orders"]
          : job.fileType === "products" ? ["products"]
          : [];
        if (rawDataTables.length > 0) {
          try {
            await clearRawData(rawDataTables);
            console.log(`[Complete Job] Cleared rawData for ${rawDataTables.join(", ")}`);
          } catch (clearErr: any) {
            console.error("[Complete Job] clearRawData error:", clearErr.message);
          }
        }
      }

      await purgeImportJobStorage(jobId).catch(() => {});

      res.json({
        success: true,
        statsRefreshed,
        statsRecalculated,
        statsWarning,
        statsError,
      });
    } catch (error: any) {
      console.error("[Complete Job] Error:", error);
      res.status(500).json({ error: error.message || "完成任務失敗" });
    }
  });

  // ─── 外部系統串接 API ──────────────────────────────────────────────────────

  /**
   * POST /api/v1/customers/upsert
   * 供外部系統（如八字命理系統）同步客戶資料到 CRM
   *
   * 驗證方式：Header X-Api-Key: <CRM_API_KEY>
   * Body: { externalId, name?, phone?, email?, gender?, lineUid?, registeredAt?, source? }
   *
   * externalId 為唯一識別碼（如 bazi_member_123），存在則更新，不存在則建立
   */
  app.post("/api/v1/customers/upsert", async (req: express.Request, res: express.Response) => {
    const apiKey = process.env.CRM_API_KEY;
    const providedKey = req.headers["x-api-key"];

    if (!apiKey) {
      console.error("[CRM Upsert] CRM_API_KEY is not configured — rejecting request");
      res.status(503).json({ success: false, error: "Service unavailable" });
      return;
    }

    if (typeof providedKey !== "string" || providedKey !== apiKey) {
      res.status(401).json({ success: false, error: "Unauthorized" });
      return;
    }

    try {
      const { externalId, name, phone, email, gender, lineUid, registeredAt, source } = req.body;

      if (!externalId) {
        res.status(400).json({ success: false, error: "externalId is required" });
        return;
      }

      const db = await getDb();
      if (!db) {
        res.status(503).json({ success: false, error: "Database unavailable" });
        return;
      }

      const { customers } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");

      // 查找是否已存在
      const [existing] = await db
        .select({ id: customers.id })
        .from(customers)
        .where(eq(customers.externalId, externalId))
        .limit(1);

      const now = new Date();
      const regAt = registeredAt ? new Date(registeredAt) : now;

      if (existing) {
        // 更新現有客戶
        const updateData: Record<string, any> = {};
        if (name !== undefined) updateData.name = name;
        if (phone !== undefined) updateData.phone = phone;
        if (email !== undefined) updateData.email = email;
        if (gender !== undefined) updateData.gender = gender;
        if (lineUid !== undefined) updateData.lineUid = lineUid;
        if (source !== undefined) updateData.custom1 = source;

        if (Object.keys(updateData).length > 0) {
          await db.update(customers).set(updateData).where(eq(customers.id, existing.id));
        }

        console.log(`[CRM Upsert] Updated customer externalId=${externalId} id=${existing.id}`);
        res.json({ success: true, action: "updated", id: existing.id });
      } else {
        // 建立新客戶
        const [result] = await db.insert(customers).values({
          externalId,
          name: name ?? null,
          phone: phone ?? null,
          email: email ?? null,
          gender: gender ?? null,
          lineUid: lineUid ?? null,
          registeredAt: regAt,
          custom1: source ?? "bazi_system",
          lifecycle: "O",
        });
        const newId = (result as any).insertId ?? 0;

        console.log(`[CRM Upsert] Created customer externalId=${externalId} id=${newId}`);
        res.json({ success: true, action: "created", id: newId });
      }
    } catch (error: any) {
      console.error("[CRM Upsert] Error:", error);
      res.status(500).json({ success: false, error: error.message || "Internal server error" });
    }
  });

  registerCronRoutes(app);

  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  if (process.env.NODE_ENV !== "production") {
    const { setupVite } = await import("./vite");
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = Number.parseInt(process.env.PORT || "8080", 10);
  const port =
    process.env.NODE_ENV === "production"
      ? preferredPort
      : await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  const host = "0.0.0.0";
  server.listen(port, host, () => {
    console.log(`Server listening on http://${host}:${port}/`);
  });
}

startServer().catch((error) => {
  console.error("[Server] Failed to start:", error);
  process.exit(1);
});
