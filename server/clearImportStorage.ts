/**
 * Purge uploaded import files from object storage as soon as they are no longer needed.
 * Excel is removed after parsing; intermediate JSON is removed after import completes.
 */
import { eq } from "drizzle-orm";
import { importJobs } from "../drizzle/schema";
import { getDb } from "./db";
import { storageDelete } from "./storage";

export async function deleteImportStorageFile(fileKey: string): Promise<void> {
  if (!fileKey?.trim()) return;
  try {
    await storageDelete(fileKey);
    console.log(`[ImportStorage] Deleted ${fileKey}`);
  } catch (err: any) {
    console.warn(`[ImportStorage] Failed to delete ${fileKey}:`, err.message);
  }
}

/** Remove any remaining storage objects and clear file references on the import job. */
export async function purgeImportJobStorage(jobId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const [job] = await db
    .select({ fileKey: importJobs.fileKey })
    .from(importJobs)
    .where(eq(importJobs.id, jobId))
    .limit(1);

  if (job?.fileKey) {
    await deleteImportStorageFile(job.fileKey);
  }

  await db.update(importJobs).set({
    fileUrl: null,
    fileKey: null,
    jsonUrl: null,
  }).where(eq(importJobs.id, jobId));
}
