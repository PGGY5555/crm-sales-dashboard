import crypto from "node:crypto";
import fs from "node:fs";

const tag = process.argv[2];
if (!tag) {
  console.error("Usage: pnpm db:migration:hash <migration_tag>");
  console.error("Example: pnpm db:migration:hash 0016_abandoned_caretaker");
  process.exit(1);
}

const path = `drizzle/${tag}.sql`;
const sql = fs.readFileSync(path, "utf8");
const hash = crypto.createHash("sha256").update(sql).digest("hex");
const journal = JSON.parse(fs.readFileSync("drizzle/meta/_journal.json", "utf8")) as {
  entries: { tag: string; when: number }[];
};
const entry = journal.entries.find((e) => e.tag === tag);
if (!entry) {
  console.error(`Tag not found in journal: ${tag}`);
  process.exit(1);
}

console.log(`file: ${path}`);
console.log(`hash: ${hash}`);
console.log(`created_at (when): ${entry.when}`);
