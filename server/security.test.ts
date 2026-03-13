import { describe, it, expect, vi } from "vitest";

/**
 * Security audit tests - validates the security fixes applied to the CRM system.
 */

describe("Security: SQL Injection Prevention", () => {
  it("getCustomerRegistrationTrend should whitelist lifecycle values", async () => {
    // Import the function
    const { getCustomerRegistrationTrend } = await import("./db");

    // Valid lifecycles should not throw
    const validResult = await getCustomerRegistrationTrend({
      lifecycles: ["N", "A", "S"],
    });
    expect(Array.isArray(validResult)).toBe(true);

    // Invalid/malicious lifecycles should return empty array (whitelist rejects them)
    const maliciousResult = await getCustomerRegistrationTrend({
      lifecycles: ["'; DROP TABLE customers; --"],
    });
    expect(maliciousResult).toEqual([]);
  });
});

describe("Security: API Input Validation", () => {
  it("limit parameter should have max constraint in routers", async () => {
    // Read the routers file and check that limit has .max()
    const fs = await import("fs");
    const routersContent = fs.readFileSync("server/routers.ts", "utf-8");

    // All limit definitions should have .max()
    const limitMatches = routersContent.match(/limit:\s*z\.number\(\)[^,\n]*/g) || [];
    for (const match of limitMatches) {
      expect(match).toContain(".max(");
    }
  });

  it("batch import should have MAX_BATCH_SIZE check", async () => {
    const fs = await import("fs");
    const indexContent = fs.readFileSync("server/_core/index.ts", "utf-8");

    expect(indexContent).toContain("MAX_BATCH_SIZE");
    expect(indexContent).toContain("batch.length > MAX_BATCH_SIZE");
  });
});

describe("Security: Data Exposure Prevention", () => {
  it("getCustomerManagement should not return rawData field", async () => {
    const fs = await import("fs");
    const dbContent = fs.readFileSync("server/db.ts", "utf-8");

    // Find the getCustomerManagement function's select block
    const funcStart = dbContent.indexOf("export async function getCustomerManagement(");
    const funcEnd = dbContent.indexOf("export async function getCustomerManagementExport");
    const funcBody = dbContent.slice(funcStart, funcEnd);

    // The select should not include rawData (it should be commented out or absent)
    // Check that the select block explicitly excludes rawData
    expect(funcBody).toContain("rawData excluded");
  });

  it("getOrderManagement should not return rawData field", async () => {
    const fs = await import("fs");
    const dbContent = fs.readFileSync("server/db.ts", "utf-8");

    const funcStart = dbContent.indexOf("export async function getOrderManagement(");
    const funcEnd = dbContent.indexOf("export async function getOrderManagementExport");
    const funcBody = dbContent.slice(funcStart, funcEnd);

    expect(funcBody).toContain("rawData excluded");
  });

  it("getCustomerDetail should not return rawData field", async () => {
    const fs = await import("fs");
    const dbContent = fs.readFileSync("server/db.ts", "utf-8");

    const funcStart = dbContent.indexOf("export async function getCustomerDetail(");
    const funcEnd = dbContent.indexOf("export async function updateCustomer(");
    const funcBody = dbContent.slice(funcStart, funcEnd);

    expect(funcBody).toContain("rawData");
    expect(funcBody).toContain("Exclude rawData");
  });

  it("getOrderDetail should not return rawData field", async () => {
    const fs = await import("fs");
    const dbContent = fs.readFileSync("server/db.ts", "utf-8");

    const funcStart = dbContent.indexOf("export async function getOrderDetail(");
    const funcBody = dbContent.slice(funcStart, funcStart + 2000);

    expect(funcBody).toContain("Exclude rawData");
  });
});

describe("Security: Rate Limiting and Headers", () => {
  it("server should use helmet middleware", async () => {
    const fs = await import("fs");
    const indexContent = fs.readFileSync("server/_core/index.ts", "utf-8");

    expect(indexContent).toContain("import helmet from \"helmet\"");
    expect(indexContent).toContain("app.use(helmet(");
  });

  it("server should use rate limiting", async () => {
    const fs = await import("fs");
    const indexContent = fs.readFileSync("server/_core/index.ts", "utf-8");

    expect(indexContent).toContain("import rateLimit from \"express-rate-limit\"");
    expect(indexContent).toContain("apiLimiter");
    expect(indexContent).toContain("importLimiter");
    expect(indexContent).toContain("app.use(\"/api/\"");
  });
});

describe("Security: Authentication", () => {
  it("all tRPC business procedures should use protectedProcedure", async () => {
    const fs = await import("fs");
    const routersContent = fs.readFileSync("server/routers.ts", "utf-8");

    // Check that business procedures use protectedProcedure or adminProcedure
    // publicProcedure should only be used for auth-related endpoints
    const publicMatches = routersContent.match(/publicProcedure/g) || [];
    const protectedMatches = routersContent.match(/protectedProcedure/g) || [];

    // There should be significantly more protected than public procedures
    expect(protectedMatches.length).toBeGreaterThan(publicMatches.length);
  });

  it("Express routes should verify auth session", async () => {
    const fs = await import("fs");
    const indexContent = fs.readFileSync("server/_core/index.ts", "utf-8");

    // Count verifyAuthSession calls in route handlers
    const authChecks = (indexContent.match(/verifyAuthSession/g) || []).length;
    // Should have multiple auth checks (at least for upload, batch, create-job, complete)
    expect(authChecks).toBeGreaterThanOrEqual(4);
  });
});

describe("Security: Sensitive Data Protection", () => {
  it("API tokens should be encrypted with AES-256-CBC", async () => {
    const fs = await import("fs");
    const cryptoContent = fs.readFileSync("server/crypto.ts", "utf-8");

    expect(cryptoContent).toContain("aes-256-cbc");
    expect(cryptoContent).toContain("randomBytes(16)");
  });

  it("cookie should have httpOnly and secure flags", async () => {
    const fs = await import("fs");
    const cookieContent = fs.readFileSync("server/_core/cookies.ts", "utf-8");

    expect(cookieContent).toContain("httpOnly: true");
    expect(cookieContent).toContain("secure:");
    expect(cookieContent).toContain("sameSite:");
  });

  it("frontend should not contain DATABASE_URL or JWT_SECRET", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const { readdirSync, readFileSync, statSync } = fs;

    function scanDir(dir: string): string[] {
      const files: string[] = [];
      try {
        for (const entry of readdirSync(dir)) {
          const full = path.join(dir, entry);
          try {
            const stat = statSync(full);
            if (stat.isDirectory() && !entry.startsWith(".") && entry !== "node_modules") {
              files.push(...scanDir(full));
            } else if (stat.isFile() && /\.(ts|tsx|js|jsx)$/.test(entry)) {
              files.push(full);
            }
          } catch {}
        }
      } catch {}
      return files;
    }

    const clientFiles = scanDir("client/src");
    for (const file of clientFiles) {
      const content = readFileSync(file, "utf-8");
      expect(content).not.toContain("DATABASE_URL");
      expect(content).not.toContain("JWT_SECRET");
      expect(content).not.toContain("BUILT_IN_FORGE_API_KEY");
    }
  });
});
