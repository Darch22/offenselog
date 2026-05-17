import { Hono } from 'hono';
import type { MenuItemRequest, UiResponse } from '@devvit/web/shared';
import { reddit } from '@devvit/web/server';
import { getViolations, getActiveViolations, getCurrentTier } from '../core/violations';

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
  const activeViolations = await getActiveViolations(authorId, subreddit.id, 30);
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
                `${i + 1}. ${v.contentType} | ${v.action} | ${new Date(v.timestamp).toLocaleDateString()} | Mod: ${v.modName}`).join('\n')
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
        title: `Reset Violations for /u${authorName}`,
        description: `This will permanently delete all tracked violations and reset their tier to 0. This cannot be undone.`,
        fields: [
          {name: 'authorId', type: 'string', label: 'User Id', defaultValue: authorId, disabled: true},
          {name: 'authorName', type: 'string', label: 'Username', defaultValue: authorName, disabled: true}
        ],
        acceptLabel: 'Reset',
        cancelLabel: 'Cancel'
      },
    },
  }, 200)
});


