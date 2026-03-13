/**
 * Utility to clear rawData from database tables after import/sync.
 * 
 * rawData stores the original Excel/API row as JSON. Once the structured fields
 * have been parsed and stored, rawData is no longer needed and should be cleared
 * to reduce database bloat and minimize personal data exposure.
 */
import { sql } from "drizzle-orm";
import { getDb } from "./db";
import { customers, orders, products } from "../drizzle/schema";

/**
 * Clear rawData for all rows in the specified table(s).
 * Called after each import/sync operation completes successfully.
 */
export async function clearRawData(
  tables: Array<"customers" | "orders" | "products"> = ["customers", "orders", "products"]
): Promise<{ cleared: Record<string, number> }> {
  const db = await getDb();
  if (!db) return { cleared: {} };

  const tableMap = { customers, orders, products };
  const cleared: Record<string, number> = {};

  for (const tableName of tables) {
    const table = tableMap[tableName];
    const result = await db.update(table)
      .set({ rawData: null })
      .where(sql`${table.rawData} IS NOT NULL`);

    cleared[tableName] = (result[0] as any)?.affectedRows ?? 0;
  }

  return { cleared };
}
