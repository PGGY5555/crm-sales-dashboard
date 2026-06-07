import type { CellValue, Worksheet } from "exceljs";

export function normalizeHeader(header: string): string {
  return header.replace(/^\uFEFF/, "").trim();
}

export function extractCellValue(value: CellValue | null | undefined): unknown {
  if (value === null || value === undefined) return "";
  if (typeof value !== "object") return value;
  if (value instanceof Date) return value;
  if ("richText" in value) {
    return (value as { richText: Array<{ text: string }> }).richText.map((rt) => rt.text).join("");
  }
  if ("text" in value) return (value as { text: string }).text;
  if ("result" in value) return (value as { result: unknown }).result;
  return String(value);
}

/**
 * Parse worksheet rows using eachRow (reliable even when rowCount/dimensions are missing).
 */
export function parseWorksheetRows(worksheet: Worksheet): Record<string, unknown>[] {
  let headers: string[] = [];
  let maxCol = 0;
  const rows: Record<string, unknown>[] = [];

  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) {
      headers = [];
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        headers[colNumber - 1] = normalizeHeader(String(cell.value ?? ""));
        maxCol = Math.max(maxCol, colNumber);
      });
      return;
    }

    const colCount = Math.max(headers.length, maxCol);
    const obj: Record<string, unknown> = {};
    let hasValue = false;

    for (let colIndex = 0; colIndex < colCount; colIndex++) {
      const header = headers[colIndex];
      if (!header) continue;
      const value = extractCellValue(row.getCell(colIndex + 1).value);
      obj[header] = value ?? "";
      if (value !== null && value !== undefined && value !== "") hasValue = true;
    }

    if (hasValue) rows.push(obj);
  });

  return rows;
}
