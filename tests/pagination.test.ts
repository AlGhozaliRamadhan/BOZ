import { describe, it, expect } from 'vitest';
import { pageWindow } from '../src/shared/pagination.js';

describe('pageWindow', () => {
  it('renders short page counts in full', () => {
    expect(pageWindow(1, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(pageWindow(3, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('collapses to 1 2 3 4 5 … last at the start', () => {
    expect(pageWindow(1, 20)).toEqual([1, 2, 3, 4, 5, 'gap', 20]);
    expect(pageWindow(3, 20)).toEqual([1, 2, 3, 4, 5, 'gap', 20]);
    expect(pageWindow(5, 20)).toEqual([1, 2, 3, 4, 5, 'gap', 20]);
  });

  it('collapses to 1 … last-4 … last at the end', () => {
    expect(pageWindow(20, 20)).toEqual([1, 'gap', 16, 17, 18, 19, 20]);
    expect(pageWindow(18, 20)).toEqual([1, 'gap', 16, 17, 18, 19, 20]);
  });

  it('keeps a window around the current page in the middle', () => {
    expect(pageWindow(10, 20)).toEqual([1, 'gap', 9, 10, 11, 'gap', 20]);
  });

  it('always pins the first and last page', () => {
    for (let current = 1; current <= 40; current++) {
      const tokens = pageWindow(current, 40);
      expect(tokens[0]).toBe(1);
      expect(tokens[tokens.length - 1]).toBe(40);
      expect(tokens).toContain(current);
      // No two ellipses in a row, and never a leading/trailing gap.
      expect(tokens.filter(token => token === 'gap').length).toBeLessThanOrEqual(2);
    }
  });

  it('clamps an out-of-range current page', () => {
    expect(pageWindow(99, 20)).toEqual([1, 'gap', 16, 17, 18, 19, 20]);
    expect(pageWindow(0, 20)).toEqual([1, 2, 3, 4, 5, 'gap', 20]);
    expect(pageWindow(-4, 20)).toEqual([1, 2, 3, 4, 5, 'gap', 20]);
  });

  it('handles a single page and an empty board', () => {
    expect(pageWindow(1, 1)).toEqual([1]);
    expect(pageWindow(1, 0)).toEqual([]);
  });
});