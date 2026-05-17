import { Hono } from 'hono';
import { UiResponse } from '@devvit/web/shared';
import { context } from '@devvit/web/server';
import { clearViolations, setCurrentTier } from '../core/violations';



export const forms = new Hono();

forms.post('/violation-history-submit', async (c) => {
    return c.json<UiResponse>({showToast: ''}, 200);
});


forms.post('/reset-violations-submit', async(c) => {
    const values = await c.req.json<{authorId: string; authorName: string}>();
    const subredditId = context.subredditId;

    await clearViolations(subredditId, values.authorId);
    await setCurrentTier(subredditId, values.authorId, 0);

    return c.json<UiResponse>({
        showToast: `Violations reset for u/${values.authorName}.`
    }, 200);
});