// Bounded memory for rendered PDF pages.
//
// Before this budget, a page canvas stayed at full resolution forever once it
// had been scrolled past: a 100-page report held ~95 megapixels (~380 MB of
// RGBA backing store) plus every page's text-layer DOM, and a 1,000-page PDF
// would grow without limit. Pages near the viewport, the focus/adjacent pages
// and every page during printing are pinned. Other rendered pages are kept as
// a least-recently-used cache until the pixel budget is exceeded, so returning
// to a recently viewed page stays instant.

export interface RenderBudget {
  /** Record (or refresh) a rendered page and whether it is pinned right now. */
  retain(page: number, pixels: number, release: () => void, pinned: boolean): void;
  /** Update pinning when a page enters or leaves the viewport neighbourhood. */
  setPinned(page: number, pinned: boolean): void;
  /** Drop bookkeeping without releasing (the page re-rendered or unmounted). */
  forget(page: number): void;
  readonly retainedPixels: number;
  readonly retainedPages: number;
}

interface Entry { pixels: number; release: () => void; pinned: boolean; lastUsed: number }

export function createRenderBudget(maxPixels: number): RenderBudget {
  const entries = new Map<number, Entry>();
  let clock = 0;
  let total = 0;

  const enforce = () => {
    while (total > maxPixels) {
      let victim: number | null = null;
      let oldest = Infinity;
      for (const [page, entry] of entries) {
        if (!entry.pinned && entry.lastUsed < oldest) { oldest = entry.lastUsed; victim = page; }
      }
      if (victim === null) return; // everything left is pinned: never blank visible pages
      const entry = entries.get(victim)!;
      entries.delete(victim);
      total -= entry.pixels;
      entry.release();
    }
  };

  return {
    retain(page, pixels, release, pinned) {
      const previous = entries.get(page);
      if (previous) total -= previous.pixels;
      const safePixels = Number.isFinite(pixels) && pixels > 0 ? pixels : 0;
      entries.set(page, { pixels: safePixels, release, pinned, lastUsed: ++clock });
      total += safePixels;
      enforce();
    },
    setPinned(page, pinned) {
      const entry = entries.get(page);
      if (!entry) return;
      entry.pinned = pinned;
      entry.lastUsed = ++clock;
      if (!pinned) enforce();
    },
    forget(page) {
      const entry = entries.get(page);
      if (!entry) return;
      entries.delete(page);
      total -= entry.pixels;
    },
    get retainedPixels() { return total; },
    get retainedPages() { return entries.size; },
  };
}

/** ~48 million device pixels ≈ 190 MB of RGBA canvas memory per open PDF. */
export const PDF_RENDER_PIXEL_BUDGET = 48_000_000;

const budgets = new WeakMap<object, RenderBudget>();

/** One budget per open PDF.js document (each document tab has its own). */
export function renderBudgetFor(document: object): RenderBudget {
  let budget = budgets.get(document);
  if (!budget) {
    budget = createRenderBudget(PDF_RENDER_PIXEL_BUDGET);
    budgets.set(document, budget);
  }
  return budget;
}
