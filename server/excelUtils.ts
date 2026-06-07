/**
 * ExcelJS utility functions - replaces xlsx (SheetJS) with ExcelJS
 * Provides compatible parseExcel / writeExcel / countExcelRows helpers.
 */
import ExcelJS from "exceljs";
import { parseWorksheetRows } from "../shared/excelWorksheet";
import {
  assertSpreadsheetFormatSupported,
  detectSpreadsheetFormat,
  getSpreadsheetParseErrorMessage,
  parseCsvToRows,
} from "../shared/spreadsheetParse";

/**
 * Parse an Excel buffer into an array of JSON objects (like XLSX.utils.sheet_to_json).
 * First row is treated as headers. Empty values default to "".
 */
export async function parseExcel<T = Record<string, any>>(
  buffer: Buffer,
  fileName?: string,
): Promise<T[]> {
  const format = detectSpreadsheetFormat(buffer, fileName);
  assertSpreadsheetFormatSupported(format);

  if (format === "csv") {
    return parseCsvToRows<T>(buffer);
  }

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as any);
  } catch (err) {
    throw new Error(getSpreadsheetParseErrorMessage(err, format));
  }

  const worksheet = workbook.worksheets[0];
  if (!worksheet) return [];

  return parseWorksheetRows(worksheet) as T[];
}

/**
 * Count the number of data rows in an Excel buffer (excluding header).
 */
export async function countExcelRows(buffer: Buffer, fileName?: string): Promise<number> {
  const rows = await parseExcel(buffer, fileName);
  return rows.length;
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
