import { describe, it, expect } from 'vitest';
import { computeWeightedScore, parseWhitelist, parseWeights } from '../src/core/rules';
import { computeNewTier } from '../src/core/escalation';
import type { Violation } from '../src/core/violations';

const makeViolation = (rule: string): Violation => ({
    id: 'x', contentId: 'x', contentType: 'post', action: 'removelink',
    rule, modId: 'm', modName: 'mod', targetUserId: 'u',
    targetUserName: 'user', timestamp: 0
});

describe('escalation scenarios', () => {
    const t1 = 3, t2 = 5, t3 = 8;

    it('default-weighted violations escalate at threshold', () => {
        const violations = Array(3).fill(null).map(() => makeViolation(''));
        const score = computeWeightedScore(violations, new Set(), new Map());
        expect(computeNewTier(score, t1, t2, t3)).toBe(1);
    });

    it('two harassment violations weighted 3 jump straight to Tier 2', () => {
        const weights = parseWeights('Harassment: 3');
        const violations = [makeViolation('Harassment'), makeViolation('Harassment')];
        const score = computeWeightedScore(violations, new Set(), weights);
        expect(score).toBe(6);
        expect(computeNewTier(score, t1, t2, t3)).toBe(2);
    });

    it('three harassment violations weighted 3 reach Tier 3', () => {
        const weights = parseWeights('Harassment: 3');
        const violations = Array(3).fill(null).map(() => makeViolation('Harassment'));
        const score = computeWeightedScore(violations, new Set(), weights);
        expect(score).toBe(9);
        expect(computeNewTier(score, t1, t2, t3)).toBe(3);
    });

    it('whitelisted spam never escalates regardless of count', () => {
        const whitelist = parseWhitelist('Spam');
        const violations = Array(20).fill(null).map(() => makeViolation('Spam'));
        const score = computeWeightedScore(violations, whitelist, new Map());
        expect(score).toBe(0);
        expect(computeNewTier(score, t1, t2, t3)).toBe(0);
    });

    it('mixed: whitelisted spam + weighted harassment + plain violations', () => {
        const whitelist = parseWhitelist('Spam');
        const weights = parseWeights('Harassment: 3');
        const violations = [
            makeViolation('Spam'),       // 0
            makeViolation('Spam'),       // 0
            makeViolation('Harassment'), // 3
            makeViolation('Off-topic'),  // 1
            makeViolation('Off-topic'),  // 1
        ];
        const score = computeWeightedScore(violations, whitelist, weights);
        expect(score).toBe(5);
        expect(computeNewTier(score, t1, t2, t3)).toBe(2);
    });

    it('parseWeights from settings paragraph round-trips correctly', () => {
        const settingsValue = 'Harassment: 3\nHate speech: 5\nLow-effort: 0\n';
        const weights = parseWeights(settingsValue);
        expect(weights.get('harassment')).toBe(3);
        expect(weights.get('hate speech')).toBe(5);
        expect(weights.get('low-effort')).toBe(0);
    });
});