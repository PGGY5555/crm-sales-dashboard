/**
 * Frontend Excel utilities using ExcelJS (replaces xlsx/SheetJS).
 * Provides parseExcelFile (read) and exportToExcelFile (write) helpers.
 */
import ExcelJS from "exceljs";
import { parseWorksheetRows } from "@shared/excelWorksheet";
import {
  assertSpreadsheetFormatSupported,
  detectSpreadsheetFormat,
  getSpreadsheetParseErrorMessage,
  parseCsvToRows,
} from "@shared/spreadsheetParse";

/**
 * Parse an Excel File into an array of JSON objects.
 * First row is treated as headers. Empty values default to "".
 */
export async function parseExcelFile(file: File): Promise<Record<string, any>[]> {
  const arrayBuffer = await file.arrayBuffer();
  const format = detectSpreadsheetFormat(arrayBuffer, file.name);
  assertSpreadsheetFormatSupported(format);

  if (format === "csv") {
    return parseCsvToRows(arrayBuffer);
  }

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(arrayBuffer);
  } catch (err) {
    throw new Error(getSpreadsheetParseErrorMessage(err, format));
  }

  const worksheet = workbook.worksheets[0];
  if (!worksheet) return [];

  return parseWorksheetRows(worksheet) as Record<string, any>[];
}

/**
 * Export an array of JSON objects to an Excel file and trigger download.
 */
export async function exportToExcelFile(
  data: Record<string, any>[],
  fileName: string,
  sheetName: string = "Sheet1",
  headers?: string[],
): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(sheetName);

  if (data.length === 0) {
    // Empty workbook
    const buffer = await workbook.xlsx.writeBuffer();
    downloadBuffer(buffer, fileName);
    return;
  }

  const columnHeaders = headers?.length ? headers : Object.keys(data[0]);
  worksheet.addRow(columnHeaders);

  for (const row of data) {
    const values = columnHeaders.map((h) => row[h] ?? "");
    worksheet.addRow(values);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  downloadBuffer(buffer, fileName);
}

function downloadBuffer(buffer: ExcelJS.Buffer, fileName: string) {
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
