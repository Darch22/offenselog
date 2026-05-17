import { Hono } from 'hono';
import { UiResponse } from '@devvit/web/shared';



export const forms = new Hono();

forms.post('/violation-history-submit', async (c) => {
    return c.json<UiResponse>({showToast: ''}, 200)
})
