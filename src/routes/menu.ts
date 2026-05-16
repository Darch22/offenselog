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
      showToast: `u/${authorName}: ${activeViolations.length} active / ${allViolations.length} total violations | Tier ${tier}`,
    },
    200
  )
})
