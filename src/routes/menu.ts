import { Hono } from 'hono';
import type { MenuItemRequest, UiResponse } from '@devvit/web/shared';
import { reddit, settings } from '@devvit/web/server';
import { getViolations, getActiveViolations, getCurrentTier, getTopOffenders } from '../core/violations';

export const menu = new Hono();

menu.post('/view-violations', async (c) => {
  const request = await c.req.json<MenuItemRequest>();
  const targetId = request.targetId;
  
  let authorName = '';
  let authorId = '';
  
  if (targetId.startsWith('t3_')) {
    const post = await reddit.getPostById(targetId as `t3_${string}`);
    authorName = post.authorName;
    authorId = post.authorId ?? '';
  } else {
    const comment = await reddit.getCommentById(targetId as `t1_${string}`);
    authorName = comment.authorName;
    authorId = comment.authorId ?? '';
  }
  
  console.log(`Viewing violations for ${authorName}  (${authorId})`);
  
  const subreddit = await reddit.getCurrentSubreddit();
  const allViolations = await getViolations(authorId, subreddit.id);
  const decayWindowDays = Number(await settings.get('decayWindowDays')) || 30;
  const activeViolations = await getActiveViolations(authorId, subreddit.id, decayWindowDays);
  const tier = await getCurrentTier(subreddit.id, authorId);
  

  return c.json<UiResponse>(
    {
      showForm: {
        name: 'violationHistory',
        form: {
          title: `Violation History: u/${authorName}`,
          description: `Tier: ${tier} | Active: ${activeViolations.length} | Total: ${allViolations.length}`,
          fields: [
            {
              name: 'details',
              label: 'Recent Violations',
              type: 'paragraph',
              defaultValue: activeViolations.map((v, i) =>
                `#${i + 1} - ${new Date(v.timestamp).toLocaleDateString()} | Type: ${v.contentType} | Action: ${v.action}\nRule: ${v.rule || 'None'}\nMod: ${v.modName}\n`).join('\n')
            },
          ],
        },
      },
    }, 200)
})

menu.post('/reset-violations', async (c) => {
  const request = await c.req.json<MenuItemRequest>();
  const targetId = request.targetId;

  let authorName = '';
  let authorId = '';

  if (targetId.startsWith('t3_')) {
    const post = await reddit.getPostById(targetId as `t3_${string}`);
    authorName = post.authorName;
    authorId = post.authorId ?? '';
  } else {
    const comment = await reddit.getCommentById(targetId as `t1_${string}`);
    authorName = comment.authorName;
    authorId = comment.authorId ?? '';
  }

  return c.json<UiResponse>({
    showForm: {
      name: "resetViolations",
      form: {
        title: `Reset Violations for u/${authorName}`,
        description: `This will permanently delete all tracked violations and reset their tier to 0. This cannot be undone.`,
        fields: [
          {name: 'authorId', type: 'string', label: 'User Id', defaultValue: authorId, disabled: true},
          {name: 'authorName', type: 'string', label: 'Username', defaultValue: authorName, disabled: true},
          {name: 'confirm', type: 'string', label: `Type "${authorName}" to confirm`}
        ],
        acceptLabel: 'Reset',
        cancelLabel: 'Cancel'
      },
    },
  }, 200);
});


menu.post('/lookup-user', async (c) => {
  return c.json<UiResponse>({
    showForm: {
      name: 'lookupInput',
      form: {
        title: 'Lookup User Violations',
        fields: [
          {name: 'username', type: 'string', label: 'Reddit username (without u/)'}
        ],
        acceptLabel: 'Lookup'
      }
    }
  }, 200);
});


menu.post('/dashboard', async (c) => {
  const subreddit = await reddit.getCurrentSubreddit();
  const topOffenders = await getTopOffenders(subreddit.id, 7, 10);

  const text = topOffenders.length === 0
      ? 'No violations recorded in the last 7 days.'
      : topOffenders.map((u, i) => 
      `#${i + 1} i/${u.userName} - ${u.count} violations${u.count !== 1 ? 's' : ''} (Tier ${u.tier})`).join('\n');

  return c.json<UiResponse>({
    showForm: {
      name: 'dashboard',
      form: {
        title: 'OffenseLog Dahsboard',
        description: 'Top offenders - last 7 days',
        fields: [{
          name: 'report',
          type: 'paragraph',
          label: 'Top Offenders',
          defaultValue: text
        }],
      },
    },
  }, 200);
});