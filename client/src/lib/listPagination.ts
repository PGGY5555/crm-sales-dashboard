/** Pagination helpers when total count loads in a separate deferred query. */
export function formatDeferredTotal(total: number | null | undefined, loading: boolean): string {
  if (total != null) return total.toLocaleString();
  if (loading) return "…";
  return "—";
}

export function canGoNextPage(
  page: number,
  pageSize: number,
  total: number | null | undefined,
  itemsOnPage: number,
): boolean {
  if (total != null) {
    return page < Math.ceil(total / pageSize) - 1;
  }
  return itemsOnPage >= pageSize;
}

export function totalPagesFromCount(total: number | null | undefined, pageSize: number): number | null {
  if (total == null) return null;
  return Math.ceil(total / pageSize);
}
