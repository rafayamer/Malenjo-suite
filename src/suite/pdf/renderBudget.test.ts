import { describe, expect, it, vi } from 'vitest';
import { createRenderBudget, renderBudgetFor } from './renderBudget';

describe('PDF render memory budget', () => {
  it('releases the least recently used unpinned pages once over budget', () => {
    const budget = createRenderBudget(300);
    const released: number[] = [];
    for (const page of [1, 2, 3]) budget.retain(page, 100, () => released.push(page), false);
    expect(released).toEqual([]);
    budget.retain(4, 100, () => released.push(4), false);
    expect(released).toEqual([1]);
    expect(budget.retainedPixels).toBe(300);
    expect(budget.retainedPages).toBe(3);
  });

  it('never releases pinned (visible, focus, printing) pages', () => {
    const budget = createRenderBudget(150);
    const release = vi.fn();
    budget.retain(1, 100, release, true);
    budget.retain(2, 100, release, true);
    expect(release).not.toHaveBeenCalled();
    expect(budget.retainedPixels).toBe(200);
    budget.setPinned(1, false);
    expect(release).toHaveBeenCalledOnce();
    expect(budget.retainedPages).toBe(1);
  });

  it('keeps recently viewed pages cached: touching a page protects it', () => {
    const budget = createRenderBudget(200);
    const released: number[] = [];
    budget.retain(1, 100, () => released.push(1), false);
    budget.retain(2, 100, () => released.push(2), false);
    budget.setPinned(1, true);
    budget.setPinned(1, false); // page 1 was just viewed again
    budget.retain(3, 100, () => released.push(3), false);
    expect(released).toEqual([2]);
  });

  it('re-rendering a page replaces its size instead of double counting', () => {
    const budget = createRenderBudget(1000);
    budget.retain(1, 100, () => {}, false);
    budget.retain(1, 400, () => {}, false);
    expect(budget.retainedPixels).toBe(400);
    budget.forget(1);
    expect(budget.retainedPixels).toBe(0);
    budget.forget(1);
    budget.setPinned(99, true);
    expect(budget.retainedPages).toBe(0);
  });

  it('ignores invalid pixel counts and keeps one budget per document', () => {
    const budget = createRenderBudget(10);
    budget.retain(1, Number.NaN, () => {}, false);
    budget.retain(2, -5, () => {}, false);
    expect(budget.retainedPixels).toBe(0);
    const a = {}, b = {};
    expect(renderBudgetFor(a)).toBe(renderBudgetFor(a));
    expect(renderBudgetFor(a)).not.toBe(renderBudgetFor(b));
  });
});
