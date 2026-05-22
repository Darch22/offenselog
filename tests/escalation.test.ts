import { describe, it, expect } from 'vitest';
import { computeNewTier } from '../src/core/escalation';

describe('computeNewTier', () => {
    const t1 = 3;
    const t2 = 5;
    const t3 = 8;

    it('returns 0 below tier 1 threshold', () => {
        expect(computeNewTier(0, t1, t2, t3)).toBe(0);
        expect(computeNewTier(2, t1, t2, t3)).toBe(0);
    });

    it('returns 1 at tier 1 threshold', () => {
        expect(computeNewTier(3, t1, t2, t3)).toBe(1);
        expect(computeNewTier(4, t1, t2, t3)).toBe(1);
    });

    it('returns 2 at tier 2 threshold', () => {
        expect(computeNewTier(5, t1, t2, t3)).toBe(2);
        expect(computeNewTier(7, t1, t2, t3)).toBe(2);
    });

    it('returns 3 at tier 3 threshold and above', () => {
        expect(computeNewTier(8, t1, t2, t3)).toBe(3);
        expect(computeNewTier(100, t1, t2, t3)).toBe(3);
    });

    it('handles custom thresholds', () => {
        expect(computeNewTier(2, 2, 4, 6)).toBe(1);
        expect(computeNewTier(5, 2, 4, 6)).toBe(2);
        expect(computeNewTier(10, 2, 4, 6)).toBe(3);
    });

    it('handles non-integer scores (Item 1 supports decimal weights)', () => {
        expect(computeNewTier(2.9, t1, t2, t3)).toBe(0);
        expect(computeNewTier(3.0, t1, t2, t3)).toBe(1);
        expect(computeNewTier(4.9999, t1, t2, t3)).toBe(1);
    });
});