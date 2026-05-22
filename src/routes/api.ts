import { Hono } from 'hono';
import { getViolations, getActiveViolations, getCurrentTier } from '../core/violations';
import { settings } from '@devvit/web/server';


export const api = new Hono();


api.get('/violations', async (c) => {
    const subredditId = c.req.query('subredditId') ?? '';
    const userId = c.req.query('userId') ?? '';

    if (!subredditId || !userId) {
        return c.json({ error: 'subredditId and userId are required' }, 400);
    }

    const decayDays = Number(await settings.get('decayWindowDays')) || 30;
    const [all, active, tier] = await Promise.all([
        getViolations(userId, subredditId),
        getActiveViolations(userId, subredditId, decayDays),
        getCurrentTier(subredditId, userId)
    ]);

    return c.json({ 
        userId, subredditId, tier, activeCount: active.length, totalCount: all.length, violations: active
    });
});