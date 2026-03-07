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
import { importCustomersFromExcel, importOrdersFromExcel, importProductsFromExcel, importLogisticsExcel } from "../excelImport";
import { sdk } from "./sdk";
import { COOKIE_NAME } from "@shared/const";
import { parse as parseCookieHeader } from "cookie";
import { getUserByOpenId } from "../db";

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

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  // OAuth callback under /api/oauth/callback
  registerOAuthRoutes(app);

  // Excel upload API (uses multer for file handling)
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

  app.post("/api/upload/excel", upload.single("file"), async (req, res) => {
    try {
      // Verify authentication via session cookie
      const cookies = parseCookieHeader(req.headers.cookie || "");
      const sessionCookie = cookies[COOKIE_NAME];
      if (!sessionCookie) {
        res.status(401).json({ error: "未登入" });
        return;
      }
      let session: any;
      try {
        session = await sdk.verifySession(sessionCookie);
      } catch {
        res.status(401).json({ error: "登入已過期" });
        return;
      }
      if (!session) {
        res.status(401).json({ error: "登入已過期" });
        return;
      }
      // Fetch full user from DB to check role
      const dbUser = await getUserByOpenId(session.openId);
      if (!dbUser || dbUser.role !== "admin") {
        res.status(403).json({ error: "僅管理員可執行此操作" });
        return;
      }
      if (!req.file) {
        res.status(400).json({ error: "請上傳檔案" });
        return;
      }
      const fileType = req.body?.type as string;
      if (!fileType || !["customers", "orders", "products", "logistics"].includes(fileType)) {
        res.status(400).json({ error: "請指定檔案類型 (customers, orders, products, logistics)" });
        return;
      }
      let result;
      switch (fileType) {
        case "customers":
          result = await importCustomersFromExcel(req.file.buffer);
          break;
        case "orders":
          result = await importOrdersFromExcel(req.file.buffer);
          break;
        case "products":
          result = await importProductsFromExcel(req.file.buffer);
          break;
        case "logistics":
          result = await importLogisticsExcel(req.file.buffer);
          break;
      }
      res.json(result);
    } catch (error: any) {
      console.error("[Excel Upload] Error:", error);
      res.status(500).json({ error: error.message || "上傳失敗" });
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
  // development mode uses Vite, production mode uses static files
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
