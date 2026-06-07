export type ImportStatsHints = {
  customerIds?: number[];
  emails?: string[];
  phones?: string[];
  orderExternalIds?: string[];
};

function uniqueNumbers(values: number[]): number[] {
  return Array.from(new Set(values.filter((id) => id > 0)));
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((v) => v.trim()).filter(Boolean)));
}

export function mergeImportStatsHints(a: ImportStatsHints, b: ImportStatsHints): ImportStatsHints {
  return {
    customerIds: uniqueNumbers([...(a.customerIds ?? []), ...(b.customerIds ?? [])]),
    emails: uniqueStrings([...(a.emails ?? []), ...(b.emails ?? [])]),
    phones: uniqueStrings([...(a.phones ?? []), ...(b.phones ?? [])]),
    orderExternalIds: uniqueStrings([...(a.orderExternalIds ?? []), ...(b.orderExternalIds ?? [])]),
  };
}

export function hasImportStatsHints(hints: ImportStatsHints): boolean {
  return (
    (hints.customerIds?.length ?? 0) > 0
    || (hints.emails?.length ?? 0) > 0
    || (hints.phones?.length ?? 0) > 0
    || (hints.orderExternalIds?.length ?? 0) > 0
  );
}

export function parseJobResultField(result: unknown): Record<string, unknown> {
  if (!result) return {};
  if (typeof result === "string") {
    try {
      const parsed = JSON.parse(result) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
    return {};
  }
  if (typeof result === "object" && !Array.isArray(result)) {
    return result as Record<string, unknown>;
  }
  return {};
}

export function parseImportStatsHints(result: unknown): ImportStatsHints {
  const root = parseJobResultField(result);
  const statsHints = root.statsHints;
  if (!statsHints || typeof statsHints !== "object" || Array.isArray(statsHints)) return {};
  const h = statsHints as ImportStatsHints;
  return {
    customerIds: uniqueNumbers(h.customerIds ?? []),
    emails: uniqueStrings(h.emails ?? []),
    phones: uniqueStrings(h.phones ?? []),
    orderExternalIds: uniqueStrings(h.orderExternalIds ?? []),
  };
}
