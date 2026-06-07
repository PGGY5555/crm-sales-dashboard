import { and, gt, isNotNull } from "drizzle-orm";
import { customers } from "../drizzle/schema";
import { getDb } from "./db";

export type CustomerSyncPayload = {
  name: string | null;
  email: string | null;
};

const LOG_PREFIX = "[HiEmailSync]";

function parseSyncStartDate(value: string): Date | null {
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    console.error(`${LOG_PREFIX} Invalid SYNC_START_DATE format (expected YYYY-MM-DD): ${trimmed}`);
    return null;
  }
  const parsed = new Date(`${trimmed}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    console.error(`${LOG_PREFIX} Invalid SYNC_START_DATE value: ${trimmed}`);
    return null;
  }
  return parsed;
}

/** Sync customers (registeredAt > SYNC_START_DATE) to HiEmail one subscriber at a time. */
export async function syncCustomersToExternalApi(): Promise<{
  ok: boolean;
  sent: number;
  failed: number;
  skipped?: boolean;
  error?: string;
}> {
  const targetUrl = process.env.EXTERNAL_TARGET_API_URL?.trim();
  const startDateStr = process.env.SYNC_START_DATE?.trim();
  const apiToken = process.env.EXTERNAL_API_TOKEN?.trim();

  if (!targetUrl || !startDateStr || !apiToken) {
    console.warn(
      `${LOG_PREFIX} Skipped — SYNC_START_DATE, EXTERNAL_TARGET_API_URL, and EXTERNAL_API_TOKEN must all be set`,
    );
    return { ok: false, sent: 0, failed: 0, skipped: true, error: "missing_config" };
  }

  const startDate = parseSyncStartDate(startDateStr);
  if (!startDate) {
    return { ok: false, sent: 0, failed: 0, error: "invalid_start_date" };
  }

  const db = await getDb();
  if (!db) {
    console.error(`${LOG_PREFIX} Database unavailable`);
    return { ok: false, sent: 0, failed: 0, error: "database_unavailable" };
  }

  try {
    const rows = await db
      .select({
        name: customers.name,
        email: customers.email,
      })
      .from(customers)
      .where(and(isNotNull(customers.registeredAt), gt(customers.registeredAt, startDate)));

    if (rows.length === 0) {
      console.log(
        `${LOG_PREFIX} No customers found with registeredAt > ${startDateStr} — nothing to send`,
      );
      return { ok: true, sent: 0, failed: 0 };
    }

    console.log(
      `${LOG_PREFIX} Syncing ${rows.length} customer(s) to ${targetUrl} (registeredAt > ${startDateStr})`,
    );

    let sent = 0;
    let failed = 0;

    for (const customer of rows) {
      const payload: CustomerSyncPayload = {
        name: customer.name ?? null,
        email: customer.email ?? null,
      };

      try {
        const response = await fetch(targetUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiToken}`,
          },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const bodyText = await response.text().catch(() => "");
          console.error(
            `${LOG_PREFIX} Failed email=${payload.email ?? "n/a"} name=${payload.name ?? "n/a"} — HTTP ${response.status}${bodyText ? `: ${bodyText.slice(0, 200)}` : ""}`,
          );
          failed++;
          continue;
        }

        sent++;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(
          `${LOG_PREFIX} Failed email=${payload.email ?? "n/a"} name=${payload.name ?? "n/a"} — ${message}`,
        );
        failed++;
      }
    }

    console.log(`${LOG_PREFIX} Finished — sent=${sent}, failed=${failed}, total=${rows.length}`);
    return { ok: true, sent, failed };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`${LOG_PREFIX} Failed — ${message}`);
    return { ok: false, sent: 0, failed: 0, error: message };
  }
}
