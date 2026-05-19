import { Hono } from 'hono';
import type { OnAppInstallRequest, TriggerResponse } from '@devvit/web/shared';
import { addViolation, Violation, getActiveViolations, removeViolation, getCurrentTier, setCurrentTier, updateViolationRule } from '../core/violations'
import { checkEscalation } from '../core/escalation';
import { reddit, settings } from '@devvit/web/server';


export const triggers = new Hono();

triggers.post('/on-app-install', async (c) => {
  const input = await c.req.json<OnAppInstallRequest>();
  console.log('App installed to subreddit: r/' + input.subreddit?.name);

  try {
    const subredditId = input.subreddit?.id;
    const subredditName = input.subreddit?.name;

    if (subredditId && subredditName) {
      await reddit.modMail.createModNotification({
        subredditId: subredditId as `t5_${string}`,
        subject: `[OffenseLog] Installed in r/${subredditName}`,
        bodyMarkdown: `OffenseLog is now active in this subreddit. It tracks moderator removals per user and runs a 3-tier escalation engine (warn → temp ban → perma ban) with automatic decay after a configurable window.\n\n**Recommended first step: enable Dry run mode.**\nGo to *Subreddit Settings → Apps → OffenseLog* and turn on **Dry run mode**. This lets OffenseLog log violations and compute tiers without sending any DMs or bans. You'll see [DRY RUN] modmail notifications showing what the system would have done. Review for a week, tune thresholds, then disable dry-run to go live.\n\n**Defaults:**\n- Tier 1 (warning DM): 3 violations\n- Tier 2 (temp ban, 14 days): 5 violations\n- Tier 3 (permanent ban): 8 violations\n- Violations decay after 30 days\n\n**Moderator tools:**\n- Click mod actions on any post or comment → "View Violation History" or "Reset Violation History"\n- Subreddit menu → "Lookup User Violations" (search by username)\n\nConfigure thresholds, decay window, ban duration, and message templates in Subreddit Settings → Apps → OffenseLog.`});
    }
  } catch (err) {
    console.error('Failed to send welcome modmail:', err);
  }

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

      const banDuration = Number(await settings.get('tier2BanDuration')) || 14;
      const actionTaken = newTier === 1 ? 'a warning DM' : newTier === 2 ? `a ${banDuration}-day temp ban`: 'a permanent ban'

      try {
        await reddit.sendPrivateMessage({
              to: input.moderator.name,
              subject: `[OffenseLog] Escalation triggered in r/${input.subreddit.name}`,
              text: `Your removal of ${input.targetUser.name}'s content pushed them to Tier ${newTier}. OffenseLog has issued ${actionTaken}.`
          });
      } catch (err) {
        console.error('Failed to notify acting mod: ', err);
        
      }
    }

    if (newTier < currentTier) {
      const dryRun = Boolean(await settings.get('dryRun'));   

      await setCurrentTier(input.subreddit.id, input.targetUser.id, newTier)
      if (newTier === 0) {
        if(!dryRun) {
          try {
            await reddit.sendPrivateMessage({
              to: input.targetUser.name,
              subject: `Standing update from r/${input.subreddit.name}`,
              text: `Hi u/${input.targetUser.name}, your violations in r/${input.subreddit.name} have expired. You are back in good standing.`
            });
          } catch (err) {
            console.error('Failed to send de-escalation DM: ', err);
          }
        }
      }

      try {
        await reddit.modMail.createModNotification({
          subredditId: input.subreddit.id as `t5_${string}`,
          subject: `[OffenseLog] De-escalation: u/${input.targetUser.name}`,
          bodyMarkdown: `${dryRun ? '**DRY RUN - no action was taken.**\n\n' : ''}**u/${input.targetUser.name}** dropped from Tier ${currentTier} to Tier ${newTier} after violation decay.`
        });
      } catch(err) {
        console.error('Failed to send de-escalation modmail:', err);
      }
    }

    console.log(`User ${input.targetUser.name}: ${activeViolations.length} active violations, Tier ${newTier}`);

    return c.json({status: 'success'}, 200);
  } catch (err) {
    console.error('Error in mod action handler:', err);

    return c.json({status: 'error'}, 200);
  }
});
