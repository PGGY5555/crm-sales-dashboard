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
import {
  importCustomersChunk,
  importOrdersChunk,
  importProductsChunk,
  importLogisticsChunk,
} from "../excelImportChunked";
import {
  createImportJob,
  getImportJobStatus,
} from "../excelImport";
import { storagePut } from "../storage";
import { sdk } from "./sdk";
import { COOKIE_NAME } from "@shared/const";
import { parse as parseCookieHeader } from "cookie";
import { getUserByOpenId, logAudit } from "../db";
import { getDb } from "../db";
import { importJobs } from "../../drizzle/schema";
import { eq } from "drizzle-orm";

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

// Helper: verify admin session from request
async function verifyAdminSession(req: express.Request): Promise<{ dbUser: any } | { error: string; status: number }> {
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
  if (!dbUser || dbUser.role !== "admin") return { error: "僅管理員可執行此操作", status: 403 };

  return { dbUser };
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerOAuthRoutes(app);

  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

  // ===== STEP 1: Upload Excel file to S3 and create import job =====
  app.post("/api/upload/excel", upload.single("file"), async (req, res) => {
    try {
      const auth = await verifyAdminSession(req);
      if ("error" in auth) {
        res.status(auth.status).json({ error: auth.error });
        return;
      }
      const { dbUser } = auth;

      if (!req.file) {
        res.status(400).json({ error: "請上傳檔案" });
        return;
      }
      const fileType = req.body?.type as string;
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
  // Frontend calls this repeatedly until job is completed/failed.
  // Each call processes ~2000 rows and returns within 15-20 seconds.
  app.post("/api/import/process", async (req, res) => {
    try {
      const auth = await verifyAdminSession(req);
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
        res.json({ status: "completed", done: true, processedRows: job.processedRows, successRows: job.successRows, errorRows: job.errorRows });
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

      // Download file from S3
      if (!job.fileUrl) {
        await db.update(importJobs).set({
          status: "failed",
          errorMessage: "找不到上傳的檔案（fileUrl 為空）",
          completedAt: new Date(),
        }).where(eq(importJobs.id, jobId));
        res.json({ status: "failed", done: true, message: "找不到上傳的檔案" });
        return;
      }

      let fileBuffer: Buffer;
      try {
        const fileResponse = await fetch(job.fileUrl);
        if (!fileResponse.ok) throw new Error(`HTTP ${fileResponse.status}`);
        const arrayBuffer = await fileResponse.arrayBuffer();
        fileBuffer = Buffer.from(arrayBuffer);
      } catch (dlErr: any) {
        await db.update(importJobs).set({
          status: "failed",
          errorMessage: "從儲存空間下載檔案失敗: " + dlErr.message,
          completedAt: new Date(),
        }).where(eq(importJobs.id, jobId));
        res.json({ status: "failed", done: true, message: "下載檔案失敗: " + dlErr.message });
        return;
      }

      const typeLabels: Record<string, string> = {
        customers: '顧客列表', orders: '訂單列表', products: '商品列表', logistics: '訂單物流檔',
      };

      // Process ONE CHUNK (the chunk functions handle offset tracking via job.processedRows)
      try {
        let chunkResult: { done: boolean; processedRows: number; successRows: number; errorRows: number; totalRows: number };
        const offset = job.processedRows || 0;

        switch (job.fileType) {
          case "customers":
            chunkResult = await importCustomersChunk(fileBuffer, jobId, offset);
            break;
          case "orders":
            chunkResult = await importOrdersChunk(fileBuffer, jobId, offset);
            break;
          case "products":
            chunkResult = await importProductsChunk(fileBuffer, jobId, offset);
            break;
          case "logistics":
            chunkResult = await importLogisticsChunk(fileBuffer, jobId, offset);
            break;
          default:
            throw new Error("不支援的檔案類型: " + job.fileType);
        }

        if (chunkResult.done) {
          // Log completion
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
