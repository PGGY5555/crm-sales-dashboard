/**
 * ExcelJS utility functions - replaces xlsx (SheetJS) with ExcelJS
 * Provides compatible parseExcel / writeExcel / countExcelRows helpers.
 */
import ExcelJS from "exceljs";

/**
 * Parse an Excel buffer into an array of JSON objects (like XLSX.utils.sheet_to_json).
 * First row is treated as headers. Empty values default to "".
 */
export async function parseExcel<T = Record<string, any>>(buffer: Buffer): Promise<T[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as any);
  const worksheet = workbook.worksheets[0];
  if (!worksheet || worksheet.rowCount === 0) return [];

  const headers: string[] = [];
  const headerRow = worksheet.getRow(1);
  headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    headers[colNumber - 1] = String(cell.value ?? "").trim();
  });

  if (headers.length === 0) return [];

  const rows: T[] = [];
  for (let rowIndex = 2; rowIndex <= worksheet.rowCount; rowIndex++) {
    const row = worksheet.getRow(rowIndex);
    const obj: Record<string, any> = {};
    let hasValue = false;

    for (let colIndex = 0; colIndex < headers.length; colIndex++) {
      const header = headers[colIndex];
      if (!header) continue;

      const cell = row.getCell(colIndex + 1);
      let value: any = cell.value;

      // Handle ExcelJS rich text objects
      if (value && typeof value === "object") {
        if ("richText" in value) {
          value = (value as ExcelJS.CellRichTextValue).richText
            .map((rt: any) => rt.text)
            .join("");
        } else if ("text" in value) {
          value = (value as any).text;
        } else if ("result" in value) {
          // Formula cell - use the result
          value = (value as ExcelJS.CellFormulaValue).result;
        } else if (value instanceof Date) {
          // Keep Date as-is for date parsing
        } else {
          value = String(value);
        }
      }

      // Default empty values to "" (like xlsx defval: "")
      obj[header] = value ?? "";
      if (value !== null && value !== undefined && value !== "") {
        hasValue = true;
      }
    }

    if (hasValue) {
      rows.push(obj as T);
    }
  }

  return rows;
}

/**
 * Count the number of data rows in an Excel buffer (excluding header).
 */
export async function countExcelRows(buffer: Buffer): Promise<number> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as any);
  const worksheet = workbook.worksheets[0];
  if (!worksheet || worksheet.rowCount <= 1) return 0;
  return worksheet.rowCount - 1; // subtract header row
}

/**
 * Create an Excel buffer from an array of JSON objects.
 * Used for export functionality.
 */
export async function createExcelBuffer(
  data: Record<string, any>[],
  sheetName: string = "Sheet1",
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(sheetName);

  if (data.length === 0) {
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  // Use keys from first row as headers
  const headers = Object.keys(data[0]);
  worksheet.addRow(headers);

  for (const row of data) {
    const values = headers.map((h) => row[h] ?? "");
    worksheet.addRow(values);
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
