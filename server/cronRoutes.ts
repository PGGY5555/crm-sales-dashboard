import type express from "express";
import { syncCustomersToExternalApi } from "./cron";

/** Verify GCP Cloud Scheduler via Authorization: Bearer <CRON_SECRET_TOKEN>. */
export function verifyCronSecret(req: express.Request): boolean {
  const secret = process.env.CRON_SECRET_TOKEN?.trim();
  if (!secret) return false;

  const authHeader = req.headers.authorization;
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    return authHeader.slice("Bearer ".length) === secret;
  }

  return false;
}

export function registerCronRoutes(app: express.Application): void {
  app.post("/api/cron/sync-customers", async (req, res) => {
    if (!process.env.CRON_SECRET_TOKEN?.trim()) {
      console.error("[CronRoute] CRON_SECRET_TOKEN is not configured — rejecting request");
      res.status(503).json({ success: false, message: "Cron endpoint not configured" });
      return;
    }

    if (!verifyCronSecret(req)) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    try {
      const result = await syncCustomersToExternalApi();

      if (result.skipped) {
        res.status(503).json({
          success: false,
          message: "Sync skipped — missing required HiEmail sync environment variables",
          error: result.error,
        });
        return;
      }

      if (!result.ok) {
        res.status(500).json({
          success: false,
          message: "Sync failed",
          error: result.error,
          sent: result.sent,
          failed: result.failed,
        });
        return;
      }

      res.json({
        success: true,
        message: "Sync triggered",
        sent: result.sent,
        failed: result.failed,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[CronRoute] sync-customers error:", message);
      res.status(500).json({ success: false, message: "Sync failed", error: message });
    }
  });
}
