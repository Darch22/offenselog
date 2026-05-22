import { Hono } from 'hono';
import { getViolations, getActiveViolations, getCurrentTier, getTopOffenders } from '../core/violations';
import { settings, context } from '@devvit/web/server';


export const api = new Hono();


api.get('/violations/:userId', async (c) => {
    const userId = c.req.param('userId');

    if (!userId) {
        return c.json({ error: 'userId is required' }, 400);
    }

    const subredditId = context.subredditId;
    const decayDays = Number(await settings.get('decayWindowDays')) || 30;

    const [all, active, tier] = await Promise.all([
        getViolations(userId, subredditId),
        getActiveViolations(userId, subredditId, decayDays),
        getCurrentTier(subredditId, userId)
    ]);

    return c.json({
        userId,
        subredditId,
        tier,
        activeCount: active.length,
        totalCount: all.length,
        violations: active
    });
});

api.get('/top-offenders', async (c) => {
    const subredditId = context.subredditId;
    const days = Number(c.req.query('days')) || 7;
    const limit = Number(c.req.query('limit')) || 10;

    const offenders = await getTopOffenders(subredditId, days, limit);

    return c.json({
        subredditId,
        days,
        offenders
    });
});