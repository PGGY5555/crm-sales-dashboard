/**
 * Baseline Drizzle migration tracking for an existing production database.
 *
 * Problem: `drizzle-kit migrate` compares the latest row in `__drizzle_migrations`
 * against journal timestamps. If the table is empty, it replays ALL migrations
 * from 0000 (CREATE TABLE users) and fails on existing tables.
 *
 * Usage (production DB already at schema 0015):
 *   pnpm db:baseline:0015
 *   pnpm db:migrate
 *
 * Or apply 2FA columns manually:
 *   See drizzle/manual/0016_add_two_factor_columns.sql
 */
import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs";
import mysql from "mysql2/promise";

const MIGRATIONS_FOLDER = "drizzle";
const BASELINE_TAG = "0015_closed_ultimo";
const BASELINE_WHEN = 1773131180576;

function migrationHash(tag: string): string {
  const sql = fs.readFileSync(`${MIGRATIONS_FOLDER}/${tag}.sql`, "utf8");
  return crypto.createHash("sha256").update(sql).digest("hex");
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  const conn = await mysql.createConnection(url);

  try {
    const [tables] = await conn.query<any[]>("SHOW TABLES LIKE 'users'");
    if (tables.length === 0) {
      console.error("Table `users` not found — this script is for existing production DBs.");
      process.exit(1);
    }

    const [cols] = await conn.query<any[]>(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'
         AND COLUMN_NAME IN ('twoFactorSecret', 'twoFactorEnabled')`
    );
    if (cols.length > 0) {
      console.log("2FA columns already exist on `users`. Nothing to baseline for 2FA.");
    }

    const [rows] = await conn.query<any[]>(
      "SELECT id, hash, created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1"
    );
    const last = rows[0] as { created_at: number } | undefined;

    if (last && Number(last.created_at) >= BASELINE_WHEN) {
      console.log(
        `__drizzle_migrations already at created_at=${last.created_at} (>= 0015). Skip baseline.`
      );
      console.log("Run: pnpm db:migrate");
      return;
    }

    const hash = migrationHash(BASELINE_TAG);
    await conn.query("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)", [
      hash,
      BASELINE_WHEN,
    ]);

    console.log(`Inserted baseline for ${BASELINE_TAG}`);
    console.log(`  hash: ${hash}`);
    console.log(`  created_at: ${BASELINE_WHEN}`);
    console.log("");
    console.log("Next step: pnpm db:migrate");
    console.log("  (will apply only 0016_abandoned_caretaker — ALTER TABLE users ADD 2FA columns)");
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
