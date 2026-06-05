import "dotenv/config";
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { sql } from "drizzle-orm";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("❌ DATABASE_URL 未設定，請確認 .env 檔案");
  process.exit(1);
}

try {
  const connection = await mysql.createConnection(databaseUrl);
  const db = drizzle(connection);

  await db.execute(sql`SELECT 1`);

  console.log("✅ 資料庫連線成功！MySQL 連線正常。");

  await connection.end();
  process.exit(0);
} catch (error) {
  console.error("❌ 資料庫連線失敗：", error);
  process.exit(1);
}
