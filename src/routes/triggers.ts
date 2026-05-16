import { Hono } from 'hono';
import type { OnAppInstallRequest, TriggerResponse } from '@devvit/web/shared';
import { addViolation, Violation, getViolations, getActiveViolations, removeViolation, clearViolations } from '../core/violations'
import { checkEscalation } from '../core/escalation';


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

  
  
  const allViolations = await getViolations(input.targetUser.id, input.subreddit.id);
  console.log('All violations: ', JSON.stringify(allViolations, null, 2));

  const activeViolations = await getActiveViolations(input.targetUser.id, input.subreddit.id, 30)

  const newTier = await checkEscalation(
    activeViolations.length,
    0,
    input.targetUser.id,
    input.targetUser.name,
    input.subreddit.id,
    input.subreddit.name
  );

  console.log(`User ${input.targetUser.name}: ${activeViolations.length} active violations, Tier ${newTier}`);




  return c.json({status: 'success'}, 200);
});
