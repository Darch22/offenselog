import { Hono } from 'hono';
import type { OnAppInstallRequest, TriggerResponse } from '@devvit/web/shared';
import { addViolation, Violation } from '../core/violations'


export const triggers = new Hono();

triggers.post('/on-app-install', async (c) => {
  const input = await c.req.json<OnAppInstallRequest>();
  console.log('App installed to subreddit: r/' + input.subreddit?.name);

  return c.json<TriggerResponse>(
    {
      status: 'success',
    },
    200
  );
});

triggers.post('/on-mod-action', async (c) => {
  const input = await c.req.json();
  if (input.action === 'removelink' || input.action === 'removecomment' || input.action === 'spamlink' || input.action === 'spamcomment') {
    const contentId = input.targetPost.id !== "" ? input.targetPost.id : input.targetComment.id;
    const violationId = `${contentId}-${new Date(input.actionedAt).getTime()}`;
    const violation: Violation = {
      id: violationId,
      contentId: contentId,
      contentType: input.action.includes('link') ? 'post' : 'comment',
      action: input.action,
      modId: input.moderator.id,
      modName: input.moderator.name,
      targetUserId: input.targetUser.id,
      targetUserName: input.targetUser.name,
      timestamp: new Date(input.actionedAt).getTime()
    };

    const wasStored = await addViolation(input.subreddit.id, violation)
    console.log(`Violation ${wasStored ? 'stored' : 'duplicate skipped'}: ${violationId}`);
  }
  return c.json({status: 'success'}, 200)
});
