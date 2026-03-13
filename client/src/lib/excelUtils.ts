/**
 * Frontend Excel utilities using ExcelJS (replaces xlsx/SheetJS).
 * Provides parseExcelFile (read) and exportToExcelFile (write) helpers.
 */
import ExcelJS from "exceljs";

/**
 * Parse an Excel File into an array of JSON objects.
 * First row is treated as headers. Empty values default to "".
 */
export async function parseExcelFile(file: File): Promise<Record<string, any>[]> {
  const arrayBuffer = await file.arrayBuffer();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(arrayBuffer);
  const worksheet = workbook.worksheets[0];
  if (!worksheet || worksheet.rowCount === 0) return [];

  const headers: string[] = [];
  const headerRow = worksheet.getRow(1);
  headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    headers[colNumber - 1] = String(cell.value ?? "").trim();
  });

  if (headers.length === 0) return [];

  const rows: Record<string, any>[] = [];
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
          value = (value as any).richText.map((rt: any) => rt.text).join("");
        } else if ("text" in value) {
          value = (value as any).text;
        } else if ("result" in value) {
          value = (value as any).result;
        } else if (value instanceof Date) {
          // Keep Date as-is
        } else {
          value = String(value);
        }
      }

      obj[header] = value ?? "";
      if (value !== null && value !== undefined && value !== "") {
        hasValue = true;
      }
    }

    if (hasValue) {
      rows.push(obj);
    }
  }

  return rows;
}

/**
 * Export an array of JSON objects to an Excel file and trigger download.
 */
export async function exportToExcelFile(
  data: Record<string, any>[],
  fileName: string,
  sheetName: string = "Sheet1",
): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(sheetName);

  if (data.length === 0) {
    // Empty workbook
    const buffer = await workbook.xlsx.writeBuffer();
    downloadBuffer(buffer, fileName);
    return;
  }

  // Use keys from first row as headers
  const headers = Object.keys(data[0]);
  worksheet.addRow(headers);

  for (const row of data) {
    const values = headers.map((h) => row[h] ?? "");
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
