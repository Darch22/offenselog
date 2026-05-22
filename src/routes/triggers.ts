import { Hono } from 'hono';
import type { OnAppInstallRequest, TriggerResponse } from '@devvit/web/shared';
import { addViolation, Violation, getActiveViolations, removeViolation, getCurrentTier, setCurrentTier, updateViolationRule, claimEscalation } from '../core/violations'
import { computeNewTier, applyEscalation } from '../core/escalation';
import { reddit, settings } from '@devvit/web/server';
import {redis} from '@devvit/redis'


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

      if (mods.some((mod: any) => mod.username === input.targetUser.name)) {
        return c.json({status: 'success'}, 200);
      }

      

      const contentId = input.targetPost.id !== "" ? input.targetPost.id : input.targetComment.id;

      const violation: Violation = {
        id: `${contentId}-${new Date(input.actionedAt).getTime()}`,
        contentId,
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
      console.log(`Violation ${wasStored ? 'stored' : 'duplicate skipped'}: ${violation.id}`);

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

    const [
      decayWindowDays,
      tier1Threshold,
      tier2Threshold,
      tier3Threshold,
      banDuration,
      warningMessage,
      banMessage,
      dryRun,
    ] = await Promise.all([
      settings.get('decayWindowDays').then(v => Number(v) || 30),
      settings.get('tier1Threshold').then(v => Number(v) || 3),
      settings.get('tier2Threshold').then(v => Number(v) || 5),
      settings.get('tier3Threshold').then(v => Number(v) || 8),
      settings.get('tier2BanDuration').then(v => Number(v) || 14),
      settings.get('warningMessage').then(v => (v as string) || 'You have received multiple content removals. Please review the community rules.'),
      settings.get('banMessage').then(v => (v as string) || 'You have been banned due to rule violations.'),
      settings.get('dryRun').then(v => Boolean(v)),
    ]);

    const [activeViolations, currentTier] = await Promise.all([
      getActiveViolations(input.targetUser.id, input.subreddit.id, decayWindowDays),
      getCurrentTier(input.subreddit.id, input.targetUser.id)
    ]);

    const newTier = computeNewTier(activeViolations.length, tier1Threshold, tier2Threshold, tier3Threshold);

    if (newTier > currentTier) {
      const claimKey = `esc_claim:${input.subreddit.id}:${input.targetUser.id}:${currentTier}->${newTier}`;
      const claimed = await claimEscalation(input.subreddit.id, input.targetUser.id, currentTier, newTier);

      if (claimed) {
        try {
          await applyEscalation (
            newTier,
            activeViolations.length,
            input.targetUser.name,
            input.subreddit.id,
            input.subreddit.name,
            banDuration,
            warningMessage,
            banMessage,
            dryRun
          );
          await setCurrentTier(input.subreddit.id, input.targetUser.id, newTier);

          if (!dryRun) {
            const actionTaken = newTier === 1
              ? 'a warning DM'
              : newTier === 2 ? `a ${banDuration}-day temp ban` : 'a permanent ban';

            try {
              await reddit.sendPrivateMessage({
                to: input.moderator.name,
                subject: `[OffenseLog] Escalation triggered in r/${input.subreddit.name}`,
                text: `Your removal of ${input.targetUser.name}'s content pushed them to Tier ${newTier}. OffenseLog has issued ${actionTaken}.`,
              });
            } catch (err) {
              console.error('Failed to notify acting mod: ', err);
            }
          }
        } finally {
          await redis.del(claimKey)
        }
      } else {
        console.log(`Escalation to Tier ${newTier} for ${input.targetUser.name} already claimed by concurrent handler`);
      }
    }

    if (newTier < currentTier) {
      await setCurrentTier(input.subreddit.id, input.targetUser.id, newTier);

      if (newTier === 0 && !dryRun) {
        try {
          await reddit.sendPrivateMessage({
            to: input.targetUser.name,
            subject: `Standing update from r/${input.subreddit.name}`,
            text: `Hi u/${input.targetUser.name}, your violations in r/${input.subreddit.name} have expired. You are back in good standing.`
          });
        } catch (err) {
          console.error('Failed to send de-escalate DM: ', err);
        }
      }

      try {
        await reddit.modMail.createModNotification({
          subredditId: input.subreddit.id as `t5_${string}`,
          subject: `[OffenseLog] De-escalation: u/${input.targetUser.name}`,
          bodyMarkdown: `${dryRun ? '**DRY RUN - no action was taken.**\n\n' : ''}**u/${input.targetUser.name}** dropped from Tier ${currentTier} to Tier ${newTier} after violation decay.`,
        });
      } catch (err) {
        console.error('Failed to send de-escalation modmail: ', err);
      }
    }

    console.log(`User ${input.targetUser.name}: ${activeViolations.length} active violations, Tier ${newTier}`);
    return c.json({ status: 'success' }, 200);
  } catch (err) {
    console.error('Error in mod action handler:', err);
    return c.json({ status: 'error' }, 200);
  }
});
