import { Hono } from 'hono';
import type { OnAppInstallRequest, TriggerResponse } from '@devvit/web/shared';
import { addViolation, Violation, getActiveViolations, removeViolation, getCurrentTier, setCurrentTier, updateViolationRule, claimEscalation, releaseEscalation } from '../core/violations'
import { computeNewTier, applyEscalation } from '../core/escalation';
import { reddit, settings } from '@devvit/web/server';
import {redis} from '@devvit/redis'
import { parseWhitelist, parseWeights, computeWeightedScore } from '../core/rules';


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
        bodyMarkdown: `**OffenseLog is now active in r/${subredditName}.**\n\nOffenseLog tracks moderator removals per user and runs a 3-tier escalation engine (warning DM → temp ban → permanent ban) with automatic decay.\n\n---\n\n**Quick-start (3 steps)**\n\n1. **Enable dry-run mode** — Settings → Apps → OffenseLog → *Dry run mode*. Logs violations and computes tiers without sending DMs or bans. Modmail still fires with a [DRY RUN] prefix. Recommended for the first week.\n\n2. **Backfill recent history** — Subreddit menu → *Backfill from Modlog*. Imports the last 7 days of removals so existing repeat offenders don't start from zero.\n\n3. **Open the dashboard** — Subreddit menu → *OffenseLog Dashboard*. Top offenders in the last 7 days with their current tier.\n\n---\n\n**Default thresholds**\n- Tier 1 (warning DM): 3 violations\n- Tier 2 (14-day temp ban): 5 violations\n- Tier 3 (permanent ban): 8 violations\n- Violations decay after 30 days\n\n---\n\n**Moderator menu items**\n\nOn posts and comments:\n- View Violation History, Reset Violation History\n- Override Tier, Delete Violation\n- Edit Mod Note\n\nOn the subreddit menu:\n- Lookup User Violations, OffenseLog Dashboard, Backfill from Modlog\n\n---\n\n**Advanced configuration** (Settings → Apps → OffenseLog)\n- Rule whitelist — rules that don't count (e.g. "Wrong flair")\n- Rule weights — count specific rules more (e.g. "Harassment: 3")\n- Modmail notification level — \`all\` | \`bans\` | \`off\` for high-volume subs\n- Custom DM templates for warnings and bans\n\n---\n\nAfter 7 days of dry-run review, disable *Dry run mode* to start enforcement.`});
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

      const cacheKey = `mod_list:${input.subreddit.id}`;
      let modUsernames: string[];
      const cached = await redis.get(cacheKey);

      if (cached) {
        modUsernames = JSON.parse(cached);
      } else {
        const subreddit = await reddit.getSubredditByName(input.subreddit.name);
        const mods = await subreddit.getModerators().all();
        modUsernames = mods.map((m: {username: string}) => m.username);

        await redis.set(cacheKey, JSON.stringify(modUsernames), {
          expiration: new Date(Date.now() + 60 * 60 * 1000 )
        });
      }

      if (modUsernames.includes(input.targetUser.name)) {
        return c.json({status: 'success'}, 200);
      }

      const isPost = input.action.includes('link');
      const contentId = isPost ? input.targetPost.id : input.targetComment.id;
      const permalink = isPost ? input.targetPost.permalink : input.targetComment.permalink

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
        timestamp: new Date(input.actionedAt).getTime(),
        permalink
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
      modmailLevel,
      ruleWhitelist,
      ruleWeights
    ] = await Promise.all([
      settings.get('decayWindowDays').then(v => Number(v) || 30),
      settings.get('tier1Threshold').then(v => Number(v) || 3),
      settings.get('tier2Threshold').then(v => Number(v) || 5),
      settings.get('tier3Threshold').then(v => Number(v) || 8),
      settings.get('tier2BanDuration').then(v => Number(v) || 14),
      settings.get('warningMessage').then(v => (v as string) || 'You have received multiple content removals. Please review the community rules.'),
      settings.get('banMessage').then(v => (v as string) || 'You have been banned due to rule violations.'),
      settings.get('dryRun').then(v => Boolean(v)),
      settings.get('modmailLevel').then(v => ((v as string) || 'all').toLowerCase()),
      settings.get('ruleWhitelist').then(v => parseWhitelist((v as string) ?? '')),
      settings.get('ruleWeights').then(v => parseWeights((v as string) ?? '')),
    ]);

    const [activeViolations, currentTier] = await Promise.all([
      getActiveViolations(input.targetUser.id, input.subreddit.id, decayWindowDays),
      getCurrentTier(input.subreddit.id, input.targetUser.id)
    ]);

    const score = computeWeightedScore(activeViolations, ruleWhitelist, ruleWeights);
    const newTier = computeNewTier(score, tier1Threshold, tier2Threshold, tier3Threshold);

    if (newTier > currentTier) {
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
            dryRun,
            modmailLevel
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
          await releaseEscalation(input.subreddit.id, input.targetUser.id, currentTier, newTier);
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

      if (modmailLevel === 'all') {
        try {
          await reddit.modMail.createModNotification({
            subredditId: input.subreddit.id as `t5_${string}`,
            subject: `[OffenseLog] De-escalation: u/${input.targetUser.name}`,
            bodyMarkdown: `${dryRun ? '**DRY RUN - no action was taken.**\n\n' : ''}**u/${input.targetUser.name}** dropped from Tier ${currentTier} to Tier ${newTier} after violation removal.`,
          });
        } catch (err) {
          console.error('Failed to send de-escalation modmail: ', err);
        }
      }
    }

    console.log(`User ${input.targetUser.name}: ${activeViolations.length} active violations (weighted score ${score}), Tier ${newTier}`);
    return c.json({ status: 'success' }, 200);

  } catch (err) {
    console.error('Error in mod action handler:', err);
    return c.json({ status: 'error' }, 200);
  }
});
