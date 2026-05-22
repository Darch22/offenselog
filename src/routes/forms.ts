import { Hono } from 'hono';
import { UiResponse } from '@devvit/web/shared';
import { context, reddit, settings } from '@devvit/web/server';
import { clearViolations, getActiveViolations, getCurrentTier, getViolations, removeViolation, setCurrentTier, setModNote, addViolation, updateViolationRule, Violation } from '../core/violations';
import { computeNewTier } from '../core/escalation';
import { computeWeightedScore, parseWeights, parseWhitelist } from '../core/rules';



export const forms = new Hono();

forms.post('/violation-history-submit', async (c) => {
    return c.json<UiResponse>({showToast: ''}, 200);
});


forms.post('/reset-violations-submit', async(c) => {
    const values = await c.req.json<{authorId: string; authorName: string; confirm: string}>();

    if(values.confirm !== values.authorName) {
        return c.json<UiResponse>({ showToast: `Confirmation didn't match. No changes made.` }, 200);
    }
    const subredditId = context.subredditId;

    await clearViolations(subredditId, values.authorId);
    await setCurrentTier(subredditId, values.authorId, 0);

    return c.json<UiResponse>({
        showToast: `Violations reset for u/${values.authorName}.`
    }, 200);
});

forms.post('/lookup-input-submit', async (c) => {
    const values = await c.req.json<{username: string}>();
    const username = values.username?.trim();

    if(!username) {
        return c.json<UiResponse>({ showToast: 'Please enter a username.' }, 200);
    }

    let user;

    try {
        user = await reddit.getUserByUsername(username);
    } catch {
        return c.json<UiResponse>({ showToast: `User u/${username} not found.` }, 200);
    }

    if (!user) {
        return c.json<UiResponse>({ showToast: `User u/${username} not found.` }, 200);
    }

    const subredditId = context.subredditId;
    const decayDays = Number(await settings.get('decayWindowDays')) || 30;
    const [all, active, tier] = await Promise.all([
        getViolations(user.id, subredditId),
        getActiveViolations(user.id, subredditId, decayDays),
        getCurrentTier(subredditId, user.id)
    ]);

    return c.json<UiResponse>({
        showForm: {
            name: 'lookupResult',
            form: {
                title: `Violation History: u/${user.username}`,
                description: `Tier: ${tier} | Active: ${active.length} | Total: ${all.length}`,
                fields: [
                    {
                        name: 'details',
                        label: 'Recent Violations',
                        type: 'paragraph',
                        defaultValue: active.length === 0 ? 'No active violations.' : active.map((v, i) => `#${i + 1} — ${new Date(v.timestamp).toLocaleDateString()}\nType: ${v.contentType} Action: ${v.action}\nRule: ${v.rule || 'None'}  Mod: ${v.modName}\nLink: ${v.permalink ? `https://reddit.com${v.permalink}` : '(none stored)'}\n`).join('\n')
                    }
                ]
            }
        }
    }, 200);
});


forms.post('/lookup-result-submit', async (c) => {
    return c.json<UiResponse>({ showToast: '' }, 200);
});

forms.post('/dashboard-submit', async (c) => {
    return c.json<UiResponse>({showToast: ''}, 200);
});


forms.post('/tier-override-submit', async (c) => {
    const values = await c.req.json<{ authorId: string; authorName: string; newTier: number }>();
    const tier = Math.round(values.newTier);

    if (isNaN(tier) || tier < 0 || tier > 3) {
        return c.json<UiResponse>({ showToast: 'Tier must be 0, 1, 2, or 3.' }, 200);
    }
    
    await setCurrentTier(context.subredditId, values.authorId, tier);
    return c.json<UiResponse>({
        showToast: `Tier for u/${values.authorName} set to ${tier}.`
    }, 200);
});

forms.post('/delete-violation-submit', async (c) => {
    const values = await c.req.json<{ authorId: string; authorName: string; violationIndex: number }>();
    const index = Math.round(values.violationIndex);
    const subredditId = context.subredditId;

    const [decayDays, tier1, tier2, tier3, whitelistRaw, weightsRaw] = await Promise.all([
        settings.get('decayWindowDays').then(v => Number(v) || 30),
        settings.get('tier1Threshold').then(v => Number(v) || 3),
        settings.get('tier2Threshold').then(v => Number(v) || 5),
        settings.get('tier3Threshold').then(v => Number(v) || 8),
        settings.get('ruleWhitelist').then(v => (v as string) ?? ''),
        settings.get('ruleWeights').then(v => (v as string) ?? ''),
    ]);

    const whitelist = parseWhitelist(whitelistRaw);
    const weights = parseWeights(weightsRaw);

    const active = await getActiveViolations(values.authorId, subredditId, decayDays);

    if (isNaN(index) || index < 1 || index > active.length) {
        return c.json<UiResponse>({
            showToast: `Enter a number between 1 and ${active.length}.`
        }, 200);
    }

    await removeViolation(subredditId, values.authorId, active[index - 1]!.contentId);

    const remaining = await getActiveViolations(values.authorId, subredditId, decayDays);
    const score = computeWeightedScore(remaining, whitelist, weights);
    const newTier = computeNewTier(score, tier1, tier2, tier3);
    await setCurrentTier(subredditId, values.authorId, newTier);

    return c.json<UiResponse>({
        showToast: `Violation #${index} deleted. u/${values.authorName} is now Tier ${newTier}.`
    }, 200);
});

forms.post('/edit-note-submit', async (c) => {
    const values = await c.req.json<{ authorId: string; authorName: string; note: string }>();
    const note = (values.note ?? '').trim();

    await setModNote(context.subredditId, values.authorId, note);

    return c.json<UiResponse>({
        showToast: note ? `Note saved for u/${values.authorName}.` : `Note cleared for u/${values.authorName}.`
    }, 200);
});


forms.post('/backfill-submit', async (c) => {
    const values = await c.req.json<{ days: number }>();
    const days = Math.min(Math.max(Math.round(values.days), 1), 7);
    const subreddit = await reddit.getCurrentSubreddit();

    const [decayDays, tier1, tier2, tier3, whitelistRaw, weightsRaw] = await Promise.all([
        settings.get('decayWindowDays').then(v => Number(v) || 30),
        settings.get('tier1Threshold').then(v => Number(v) || 3),
        settings.get('tier2Threshold').then(v => Number(v) || 5),
        settings.get('tier3Threshold').then(v => Number(v) || 8),
        settings.get('ruleWhitelist').then(v => (v as string) ?? ''),
        settings.get('ruleWeights').then(v => (v as string) ?? ''),
    ]);
    const whitelist = parseWhitelist(whitelistRaw);
    const weights = parseWeights(weightsRaw);

    const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;

    const mods = await subreddit.getModerators().all();
    const modNames = new Set(mods.map((m: any) => m.username));

    const log = await reddit.getModerationLog({
        subredditName: subreddit.name,
        limit: 1000
    }).all();

    let removalsAdded = 0;
    let approvalsProcessed = 0;
    let rulesAttached = 0;
    const affectedUsers = new Set<string>();

    for (const action of log) {
        const createdMs = (action as any).createdAt instanceof Date ? (action as any).createdAt.getTime() : Number((action as any).createdAt);

        if (createdMs < cutoffMs) break;

        const actionType = (action as any).type ?? (action as any).action ?? '';
        const targetPostId = (action as any).targetPost?.id ?? '';
        const targetCommentId = (action as any).targetComment?.id ?? '';
        const targetUserId = (action as any).targetUser?.id ?? '';
        const targetUserName = (action as any).targetUser?.name ?? '';
        const targetPermalink = (action as any).targetPost?.permalink ?? (action as any).targetComment?.permalink ?? '';

        const modName = (action as any).moderator?.name ?? '';
        const modId = (action as any).moderator?.id ?? '';

        if (modName === 'AutoModerator') continue;

        if (actionType === 'removelink' || actionType === 'removecomment' || actionType === 'spamlink' || actionType === 'spamcomment') {
            if (modNames.has(targetUserName)) continue;

            const isPost = actionType.includes('link');
            const contentId = isPost ? targetPostId : targetCommentId;
            if (!contentId || !targetUserId) continue;

            const violation: Violation = {
                id: `${contentId}-${createdMs}`,
                contentId,
                contentType: isPost ? 'post' : 'comment',
                action: actionType,
                rule: '',
                modId,
                modName,
                targetUserId,
                targetUserName,
                timestamp: createdMs,
                permalink: targetPermalink
            };

            if (await addViolation(subreddit.id, violation)) {
                removalsAdded++;
                affectedUsers.add(targetUserId);
            }
        } else if (actionType === 'approvelink' || actionType === 'approvecomment') {
            const contentId = targetPostId || targetCommentId;

            if (!contentId || !targetUserId) continue;

            if (await removeViolation(subreddit.id, targetUserId, contentId)) {
                approvalsProcessed++;
                affectedUsers.add(targetUserId);
            }
        } else if (actionType === 'addremovalreason') {
            const contentId = targetPostId || targetCommentId;

            if (!contentId || !targetUserId) continue;

            const ruleName = (action as any).description ?? '';

            if (await updateViolationRule(subreddit.id, targetUserId, contentId, ruleName)) {
                rulesAttached++;
            }
        }
    }

    for (const userId of affectedUsers) {
        const active = await getActiveViolations(userId, subreddit.id, decayDays);
        const score = computeWeightedScore(active, whitelist, weights);
        const newTier = computeNewTier(score, tier1, tier2, tier3);

        await setCurrentTier(subreddit.id, userId, newTier)
    }

    return c.json<UiResponse>({
        showToast: `Backfill complete: ${removalsAdded} added, ${approvalsProcessed} approvals, ${rulesAttached} rules, ${affectedUsers.size} users updated.`
    }, 200);
});