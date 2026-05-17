import { Hono } from 'hono';
import type { OnAppInstallRequest, TriggerResponse } from '@devvit/web/shared';
import { addViolation, Violation, getActiveViolations, removeViolation, getCurrentTier, setCurrentTier, updateViolationRule } from '../core/violations'
import { checkEscalation } from '../core/escalation';
import { reddit, settings } from '@devvit/web/server';


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
  try {
    const input = await c.req.json();

    if (input.action === 'removelink' || input.action === 'removecomment' || input.action === 'spamlink' || input.action === 'spamcomment') {

      if (input.moderator.name === 'AutoModerator') {
        return c.json({status: 'success'}, 200);
      }

      const subreddit = await reddit.getSubredditByName(input.subreddit.name);
      const mods = await subreddit.getModerators().all();
      const isMod = mods.some((mod: any) => mod.username === input.targetUser.name);

      if (isMod) {
        return c.json({status: 'success'}, 200);
      }

      const contentId = input.targetPost.id !== "" ? input.targetPost.id : input.targetComment.id;
      const violationId = `${contentId}-${new Date(input.actionedAt).getTime()}`;

      const violation: Violation = {
        id: violationId,
        contentId: contentId,
        contentType: input.action.includes('link') ? 'post' : 'comment',
        action: input.action,
        rule: '',
        modId: input.moderator.id,
        modName: input.moderator.name,
        targetUserId: input.targetUser.id,
        targetUserName: input.targetUser.name,
        timestamp: new Date(input.actionedAt).getTime()
      };

      const wasStored = await addViolation(input.subreddit.id, violation)
      console.log(`Violation ${wasStored ? 'stored' : 'duplicate skipped'}: ${violationId}`);

    }

      if (input.action === 'approvelink' || input.action === 'approvecomment') {
      const contentId = input.targetPost.id !== "" ? input.targetPost.id : input.targetComment.id;
      const wasRemoved = await removeViolation(input.subreddit.id, input.targetUser.id, contentId);

      console.log(`Re-approval: violation ${wasRemoved ? 'removed' : 'not found'} for ${contentId}`);
    }

    if (input.action === 'addremovalreason') {
      const contentId = input.targetPost.id !== "" ? input.targetPost.id : input.targetComment.id;
      const ruleName = input.description;

      await updateViolationRule(input.subreddit.id, input.targetUser.id, contentId, ruleName);

      console.log(`Rule attached: ${ruleName} to ${contentId}`);
    }

    const decayWindowDays = Number(await settings.get('decayWindowDays')) || 30;
    const activeViolations = await getActiveViolations(input.targetUser.id, input.subreddit.id, decayWindowDays)

    const currentTier = await getCurrentTier(input.subreddit.id, input.targetUser.id);

    const newTier = await checkEscalation(
      activeViolations.length,
      currentTier,
      input.targetUser.id,
      input.targetUser.name,
      input.subreddit.id,
      input.subreddit.name
    );

    if (newTier > currentTier) {
      await setCurrentTier(input.subreddit.id, input.targetUser.id, newTier);
    }

    if(newTier < currentTier) {
      await setCurrentTier(input.subreddit.id, input.targetUser.id, newTier)
      console.log(`De-escalated ${input.targetUser.name} from Tier ${currentTier} to Tier ${newTier}`);
    }

    console.log(`User ${input.targetUser.name}: ${activeViolations.length} active violations, Tier ${newTier}`);

    return c.json({status: 'success'}, 200);
  } catch (err) {
    console.error('Error in mod action handler:', err);

    return c.json({status: 'error'}, 200);
  }
});
