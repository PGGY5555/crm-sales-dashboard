export type SpreadsheetFormat = "xlsx" | "xls" | "csv" | "unknown";

const XLS_UNSUPPORTED_MSG =
  "不支援舊版 Excel (.xls) 格式，請在 Excel 中「另存新檔」選擇 .xlsx 格式後重新上傳";

const INVALID_XLSX_MSG =
  "無法讀取 Excel 檔案，檔案可能已損壞或格式不正確。請確認為有效的 .xlsx 檔案";

export function getSpreadsheetParseErrorMessage(err: unknown, format: SpreadsheetFormat): string {
  const message = err instanceof Error ? err.message : String(err);
  if (format === "xls") return XLS_UNSUPPORTED_MSG;
  if (format === "csv") return "無法解析 CSV 檔案: " + message;
  if (/central directory|is this a zip file/i.test(message)) {
    return "檔案格式無法辨識。請確認上傳的是 .xlsx 或 .csv 檔案（.xls 請先另存為 .xlsx）";
  }
  return INVALID_XLSX_MSG + (message ? ` (${message})` : "");
}

export function detectSpreadsheetFormat(
  data: Uint8Array | ArrayBuffer,
  fileName?: string,
): SpreadsheetFormat {
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
  const ext = fileName?.split(".").pop()?.toLowerCase();

  if (bytes.length >= 4) {
    if (bytes[0] === 0x50 && bytes[1] === 0x4b) return "xlsx";
    if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) {
      return "xls";
    }
  }

  if (ext === "csv") return "csv";
  if (ext === "xls") return "xls";
  if (ext === "xlsx" || ext === "xlsm") return "xlsx";

  return "unknown";
}

function decodeCsvText(data: Uint8Array): string {
  if (data.length >= 3 && data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf) {
    return new TextDecoder("utf-8").decode(data.slice(3));
  }
  return new TextDecoder("utf-8").decode(data);
}

function detectCsvDelimiter(firstLine: string): string {
  const tabs = (firstLine.match(/\t/g) || []).length;
  const commas = (firstLine.match(/,/g) || []).length;
  if (tabs > 0 && tabs >= commas) return "\t";
  return ",";
}

function parseCsvLine(line: string, delimiter: string): string[] {
  if (delimiter === "\t") {
    return line.split("\t");
  }

  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }

  result.push(current);
  return result;
}

export function parseCsvToRows<T = Record<string, any>>(data: Uint8Array | ArrayBuffer): T[] {
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
  const text = decodeCsvText(bytes).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = text.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length === 0) return [];

  const delimiter = detectCsvDelimiter(lines[0]);
  const headers = parseCsvLine(lines[0], delimiter).map((h) => h.replace(/^\uFEFF/, "").trim());
  if (headers.length === 0 || headers.every((h) => !h)) return [];

  const rows: T[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i], delimiter);
    const obj: Record<string, any> = {};
    let hasValue = false;

    for (let col = 0; col < headers.length; col++) {
      const header = headers[col];
      if (!header) continue;
      const value = (values[col] ?? "").trim();
      obj[header] = value;
      if (value) hasValue = true;
    }

    if (hasValue) rows.push(obj as T);
  }

  return rows;
}

export function assertSpreadsheetFormatSupported(format: SpreadsheetFormat): void {
  if (format === "xls") throw new Error(XLS_UNSUPPORTED_MSG);
}
