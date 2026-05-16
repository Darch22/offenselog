import { Hono } from "hono";
import {redis} from "@devvit/redis";
import { settings } from "@devvit/web/server";
import { reddit } from "@devvit/web/server";

export const scheduler = new Hono();

scheduler.post('/decay-cleanup-task', async (c) => {
    const decayDays = Number(await settings.get('decayWindowDays')) || 30;
    const cutoff = Date.now() - (decayDays * 24 * 60 * 60 * 1000);

    const subreddit = await reddit.getCurrentSubreddit();
    const activeUsersKey = `active_users:${subreddit.id}`;
    const activeUsers = await redis.zRange(activeUsersKey, 0, -1);

    for (const entry of activeUsers) {
        const userId = entry.member;
        const violationKey = `violations:${subreddit.id}:${userId}`;

        await redis.zRemRangeByScore(violationKey, 0, cutoff);

        const remaining = await redis.zCard(violationKey);

        if(remaining === 0) {
            await redis.zRem(activeUsersKey, [userId]);
        }
    }


    console.log(`Decay cleanup: checked ${activeUsers.length} users`)

    return c.json({ status: 'success' }, 200);
})