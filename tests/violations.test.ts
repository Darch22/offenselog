import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockRedis } = vi.hoisted(() => ({
    mockRedis: {
        zAdd: vi.fn(),
        zRange: vi.fn(),
        zRem: vi.fn(),
        zCard: vi.fn(),
        set: vi.fn(),
        get: vi.fn(),
        del: vi.fn(),
    }
}));

vi.mock('@devvit/redis', () => ({ redis: mockRedis }));

import { addViolation } from '../src/core/violations';
import type { Violation } from '../src/core/violations';

const makeViolation = (overrides: Partial<Violation> = {}): Violation => ({
    id: 'v1', contentId: 't3_abc', contentType: 'post', action: 'removelink',
    rule: '', modId: 'm1', modName: 'mod1', targetUserId: 'u1',
    targetUserName: 'user1', timestamp: 1_000_000, ...overrides
});

describe('addViolation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('stores when no duplicate exists', async () => {
        mockRedis.zRange.mockResolvedValue([]);
        mockRedis.zAdd.mockResolvedValue(undefined);
        mockRedis.set.mockResolvedValue(undefined);

        const result = await addViolation('sub1', makeViolation());

        expect(result).toBe(true);
        expect(mockRedis.zAdd).toHaveBeenCalled();
    });

    it('skips when same contentId exists within 5s window', async () => {
        const existing = makeViolation();
        mockRedis.zRange.mockResolvedValue([
            { member: JSON.stringify(existing), score: existing.timestamp }
        ]);

        const result = await addViolation('sub1', makeViolation({ id: 'v2', timestamp: existing.timestamp + 100 }));

        expect(result).toBe(false);
        expect(mockRedis.zAdd).not.toHaveBeenCalled();
    });

    it('always indexes by contentId on store', async () => {
        mockRedis.zRange.mockResolvedValue([]);

        await addViolation('sub1', makeViolation());

        expect(mockRedis.set).toHaveBeenCalledWith(
            expect.stringContaining('content_violation:sub1:t3_abc'),
            expect.any(String)
        );
    });
});