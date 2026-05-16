import { Hono } from 'hono';
import type { MenuItemRequest, UiResponse } from '@devvit/web/shared';
import type { FormField } from '@devvit/shared-types/shared/form.js';
import { reddit } from '@devvit/web/server';
import { getViolations, getActiveViolations, getCurrentTier } from '../core/violations';

export const menu = new Hono();

const buildNukeFields = (targetId: string): FormField[] => [
  {
    name: 'targetId',
    label: 'Target ID',
    type: 'string',
    helpText: 'Auto-filled from the selected item.',
    required: true,
    defaultValue: targetId,
  },
  {
    name: 'remove',
    label: 'Remove comments',
    type: 'boolean',
    defaultValue: true,
  },
  {
    name: 'lock',
    label: 'Lock comments',
    type: 'boolean',
    defaultValue: false,
  },
  {
    name: 'skipDistinguished',
    label: 'Skip distinguished comments',
    type: 'boolean',
    defaultValue: false,
  },
];

const buildNukeForm = (title: string, targetId: string) => ({
  fields: buildNukeFields(targetId),
  title,
  acceptLabel: 'Mop',
  cancelLabel: 'Cancel',
});

menu.post('/mop-comment', async (c) => {
  const request = await c.req.json<MenuItemRequest>();
  console.log('request', request.targetId);
  return c.json<UiResponse>(
    {
      showForm: {
        name: 'mopComment',
        form: buildNukeForm('Mop Comments', request.targetId),
      },
    },
    200
  );
});

menu.post('/mop-post', async (c) => {
  const request = await c.req.json<MenuItemRequest>();
  return c.json<UiResponse>(
    {
      showForm: {
        name: 'mopPost',
        form: buildNukeForm('Mop Post Comments', request.targetId),
      },
    },
    200
  );
});

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
