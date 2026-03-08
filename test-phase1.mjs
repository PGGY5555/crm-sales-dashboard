import XLSX from "xlsx";

const fileUrl = "https://d2xsxph8kpxj0f.cloudfront.net/310519663384030512/DN8ihETPKNPmGxAqBwYu7X/imports/1/1772964912175_2021_20260308.xlsx";

async function testPhase1() {
  const t0 = Date.now();
  
  // Step 1: Download
  console.log("Step 1: Downloading...");
  const resp = await fetch(fileUrl);
  const buf = Buffer.from(await resp.arrayBuffer());
  console.log(`  Downloaded ${(buf.length / 1024 / 1024).toFixed(1)}MB in ${Date.now() - t0}ms`);
  
  // Step 2: Parse
  const t1 = Date.now();
  console.log("Step 2: Parsing Excel...");
  const wb = XLSX.read(buf, { type: "buffer" });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });
  console.log(`  Parsed ${rows.length} rows in ${Date.now() - t1}ms`);
  
  // Step 3: JSON stringify
  const t2 = Date.now();
  console.log("Step 3: JSON stringify...");
  const jsonStr = JSON.stringify(rows);
  const jsonBuf = Buffer.from(jsonStr);
  console.log(`  JSON size: ${(jsonBuf.length / 1024 / 1024).toFixed(1)}MB in ${Date.now() - t2}ms`);
  
  console.log(`\nTotal time: ${Date.now() - t0}ms`);
  console.log(`\nIf we add S3 upload time (~2-5s for ${(jsonBuf.length / 1024 / 1024).toFixed(1)}MB), total would be ${Date.now() - t0 + 3000}ms`);
}

testPhase1().catch(console.error);
