import { Hono } from "hono";
import {redis} from "@devvit/redis";
import { settings } from "@devvit/web/server";
import { reddit } from "@devvit/web/server";
import type { Violation } from "../core/violations";

export const scheduler = new Hono();

scheduler.post('/decay-cleanup-task', async (c) => {
    const [decayDays, tier1Threshold, tier2Threshold, tier3Threshold, dryRun] = await Promise.all([
        settings.get('decayWindowDays').then(v => Number(v) || 30),
        settings.get('tier1Threshold').then(v => Number(v) || 3),
        settings.get('tier2Threshold').then(v => Number(v) || 5),
        settings.get('tier3Threshold').then(v => Number(v) || 8),
        settings.get('dryRun').then(v => Boolean(v))
    ]);

    const cutoff = Date.now() - (decayDays * 24 * 60 * 60 * 1000);



    const subreddit = await reddit.getCurrentSubreddit();
    const activeUsersKey = `active_users:${subreddit.id}`;
    const activeUsers = await redis.zRange(activeUsersKey, 0, -1);

    for (const entry of activeUsers) {
        const userId = entry.member;
        const violationKey = `violations:${subreddit.id}:${userId}`;

        const expired = await redis.zRange(violationKey, 0, cutoff, {by: 'score'});
        if (expired.length === 0) continue;

        const userName = (JSON.parse(expired[0]!.member) as Violation).targetUserName;
        const oldTierStr = await redis.get(`tier:${subreddit.id}:${userId}`);
        const oldTier = oldTierStr ? parseInt(oldTierStr) : 0;

        for (const v of expired) {
            const parsed = JSON.parse(v.member) as Violation;
            await redis.del(`content_violation:${subreddit.id}:${parsed.contentId}`);
        }
        await redis.zRemRangeByScore(violationKey, 0, cutoff);

        const remaining = await redis.zCard(violationKey);

        let newTier = 0;

        if(remaining === 0) {
            await redis.zRem(activeUsersKey, [userId]);
            await redis.set(`tier:${subreddit.id}:${userId}`, '0');
        } else {
            if (remaining >= tier3Threshold) newTier = 3;
            else if (remaining >= tier2Threshold) newTier = 2;
            else if (remaining >= tier1Threshold) newTier = 1;

            await redis.set(`tier:${subreddit.id}:${userId}`, newTier.toString());
        }

        if (newTier < oldTier) {
            try {
                await reddit.modMail.createModNotification({
                    subredditId: subreddit.id as `t5_${string}`,
                    subject: `[OffenseLog] De-escalation: u/${userName}`,
                    bodyMarkdown: `${dryRun ? '**DRY RUN - no action was taken.**\n\n' : ''}**u/${userName}** dropped from Tier ${oldTier} to Tier ${newTier} after violation decay.`
                })
            } catch (err) {
                console.error('Failed to send decay modmail: ', err);
            }
        }

        if (newTier === 0 && !dryRun) {
            try {
                const sub = await reddit.getCurrentSubreddit();
                await reddit.sendPrivateMessage({
                    to: userName,
                    subject: `Standing update from r/${sub.name}`,
                    text: `Hi u/${userName}, your violations in r/${sub.name} have expired. You are back in good standing.`
                })
            } catch (err) {
                console.error('Failed to send decay DM: ', err);
            }
        }
    }
    
    console.log(`Decay cleanup: checked ${activeUsers.length} users`)

    return c.json({ status: 'success' }, 200);
})