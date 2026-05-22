 import { describe, it, expect } from 'vitest';
import {
    parseWhitelist,
    parseWeights,
    getViolationWeight,
    computeWeightedScore
} from '../src/core/rules';
import type { Violation } from '../src/core/violations';

const makeViolation = (rule: string): Violation => ({
    id: 'x',
    contentId: 'x',
    contentType: 'post',
    action: 'removelink',
    rule,
    modId: 'm',
    modName: 'mod',
    targetUserId: 'u',
    targetUserName: 'user',
    timestamp: 0
});

describe('parseWhitelist', () => {
    it('returns empty set for empty input', () => {
        expect(parseWhitelist('')).toEqual(new Set());
    });

    it('parses a single rule', () => {
        expect(parseWhitelist('Spam')).toEqual(new Set(['spam']));
    });

    it('lowercases for case-insensitive matching', () => {
        expect(parseWhitelist('HARASSMENT')).toEqual(new Set(['harassment']));
    });

    it('handles multiple rules across lines', () => {
        const result = parseWhitelist('Spam\nWrong flair\nDuplicate post');
        expect(result).toEqual(new Set(['spam', 'wrong flair', 'duplicate post']));
    });

    it('skips blank lines and trims whitespace', () => {
        const result = parseWhitelist('Spam\n\n  Wrong flair  \n\n');
        expect(result).toEqual(new Set(['spam', 'wrong flair']));
    });

    it('deduplicates case variants', () => {
        const result = parseWhitelist('Spam\nspam\nSPAM');
        expect(result.size).toBe(1);
        expect(result.has('spam')).toBe(true);
    });
});

describe('parseWeights', () => {
    it('returns empty map for empty input', () => {
        expect(parseWeights('').size).toBe(0);
    });

    it('parses a single rule:weight pair', () => {
        const result = parseWeights('Harassment: 3');
        expect(result.get('harassment')).toBe(3);
    });

    it('lowercases keys', () => {
        const result = parseWeights('HARASSMENT: 5');
        expect(result.get('harassment')).toBe(5);
    });

    it('handles multiple lines', () => {
        const result = parseWeights('Spam: 0\nHarassment: 3\nHate speech: 5');
        expect(result.get('spam')).toBe(0);
        expect(result.get('harassment')).toBe(3);
        expect(result.get('hate speech')).toBe(5);
    });

    it('uses last colon for rule names containing colons', () => {
        const result = parseWeights('Rule: with: colons: 2');
        expect(result.get('rule: with: colons')).toBe(2);
    });

    it('skips lines without a colon', () => {
        const result = parseWeights('Spam: 1\nNoColonHere\nHarassment: 3');
        expect(result.size).toBe(2);
        expect(result.get('spam')).toBe(1);
        expect(result.get('harassment')).toBe(3);
    });

    it('skips non-numeric weights', () => {
        const result = parseWeights('Spam: not-a-number\nHarassment: 3');
        expect(result.has('spam')).toBe(false);
        expect(result.get('harassment')).toBe(3);
    });

    it('rejects negative weights', () => {
        const result = parseWeights('Spam: -1');
        expect(result.has('spam')).toBe(false);
    });

    it('accepts zero weight', () => {
        const result = parseWeights('Spam: 0');
        expect(result.get('spam')).toBe(0);
    });

    it('accepts decimal weights', () => {
        const result = parseWeights('Spam: 1.5');
        expect(result.get('spam')).toBe(1.5);
    });
});

describe('getViolationWeight', () => {
    it('returns default weight 1 for empty rule', () => {
        expect(getViolationWeight('', new Set(), new Map())).toBe(1);
    });

    it('returns default weight 1 for unknown rule', () => {
        expect(getViolationWeight('Unknown', new Set(), new Map())).toBe(1);
    });

    it('returns 0 for whitelisted rule', () => {
        const whitelist = new Set(['spam']);
        expect(getViolationWeight('Spam', whitelist, new Map())).toBe(0);
    });

    it('returns custom weight when configured', () => {
        const weights = new Map([['harassment', 3]]);
        expect(getViolationWeight('Harassment', new Set(), weights)).toBe(3);
    });

    it('matches whitelist case-insensitively', () => {
        const whitelist = new Set(['spam']);
        expect(getViolationWeight('SPAM', whitelist, new Map())).toBe(0);
        expect(getViolationWeight('Spam', whitelist, new Map())).toBe(0);
        expect(getViolationWeight('spam', whitelist, new Map())).toBe(0);
    });

    it('whitelist takes precedence over weights', () => {
        const whitelist = new Set(['spam']);
        const weights = new Map([['spam', 5]]);
        expect(getViolationWeight('Spam', whitelist, weights)).toBe(0);
    });
});

describe('computeWeightedScore', () => {
    it('returns 0 for empty violations', () => {
        expect(computeWeightedScore([], new Set(), new Map())).toBe(0);
    });

    it('sums default weights for unconfigured rules', () => {
        const violations = [makeViolation('A'), makeViolation('B'), makeViolation('C')];
        expect(computeWeightedScore(violations, new Set(), new Map())).toBe(3);
    });

    it('whitelisted rules contribute 0', () => {
        const violations = [makeViolation('Spam'), makeViolation('Harassment')];
        const whitelist = new Set(['spam']);
        expect(computeWeightedScore(violations, whitelist, new Map())).toBe(1);
    });

    it('weighted rules contribute their weight', () => {
        const violations = [makeViolation('Harassment'), makeViolation('Harassment')];
        const weights = new Map([['harassment', 3]]);
        expect(computeWeightedScore(violations, new Set(), weights)).toBe(6);
    });

    it('combines whitelist, weights, and defaults correctly', () => {
        const violations = [
            makeViolation('Spam'),
            makeViolation('Harassment'),
            makeViolation('Off-topic'),
            makeViolation('')
        ];
        const whitelist = new Set(['spam']);
        const weights = new Map([['harassment', 3]]);
        expect(computeWeightedScore(violations, whitelist, weights)).toBe(5);
    });
});