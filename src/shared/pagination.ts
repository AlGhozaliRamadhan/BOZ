// ─── shared/pagination.ts ──────────────────────────────────────────────────────
// Windowed page numbering. Pure — no DOM — so the pager UI and its tests share
// one definition of what "show every single page" should collapse into.

/** A rendered slot: a page number, or an ellipsis standing in for skipped pages. */
export type PageToken = number | 'gap';

/** Pages shown contiguously at each end before an ellipsis appears. */
export const PAGE_WINDOW_EDGE = 5;

/** Below this many pages there is nothing worth collapsing. */
const PAGE_WINDOW_INLINE_MAX = 7;

function range(start: number, end: number): number[] {
  const pages: number[] = [];
  for (let page = start; page <= end; page++) pages.push(page);
  return pages;
}

/**
 * Build the `1, 2, 3, 4, 5 … last` style token list for a pager.
 *
 * Small page counts render in full. Larger ones always pin the first and last
 * page, then keep a window of five around the current page — pinned at either
 * end so the leading run reads `1 2 3 4 5 … 12` instead of a lone `1 … 4 5 6`.
 */
export function pageWindow(current: number, pageCount: number): PageToken[] {
  const total = Math.max(0, Math.floor(pageCount) || 0);
  if (total === 0) return [];

  const page = Math.min(Math.max(1, Math.floor(current) || 1), total);
  if (total <= PAGE_WINDOW_INLINE_MAX) return range(1, total);

  if (page <= PAGE_WINDOW_EDGE) {
    return [...range(1, PAGE_WINDOW_EDGE), 'gap', total];
  }

  if (page >= total - PAGE_WINDOW_EDGE + 1) {
    return [1, 'gap', ...range(total - PAGE_WINDOW_EDGE + 1, total)];
  }

  return [1, 'gap', ...range(page - 1, page + 1), 'gap', total];
}