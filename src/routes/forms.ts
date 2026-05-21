import { Hono } from 'hono';
import { UiResponse } from '@devvit/web/shared';
import { context, reddit, settings } from '@devvit/web/server';
import { clearViolations, getActiveViolations, getCurrentTier, getViolations, setCurrentTier } from '../core/violations';



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
                        defaultValue: active.length === 0 ? 'No active violations.' : active.map((v, i) => `#${i + 1} — ${new Date(v.timestamp).toLocaleDateString()}\nType: ${v.contentType} Action: ${v.action}\nRule: ${v.rule || 'None'}  Mod: ${v.modName}\n`).join('\n')
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