import { Hono } from 'hono';
import type { MenuItemRequest, UiResponse } from '@devvit/web/shared';
import { reddit, settings } from '@devvit/web/server';
import { getViolations, getActiveViolations, getCurrentTier, getTopOffenders, getModNote } from '../core/violations';

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
  const decayWindowDays = Number(await settings.get('decayWindowDays')) || 30;
  const [allViolations, activeViolations, tier, note] = await Promise.all([
    getViolations(authorId, subreddit.id),
    getActiveViolations(authorId, subreddit.id, decayWindowDays),
    getCurrentTier(subreddit.id, authorId),
    getModNote(subreddit.id, authorId)
  ]);
  

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
              defaultValue: activeViolations.length === 0
                ? 'No active violations.'
                : activeViolations.map((v, i) =>
                `#${i + 1} - ${new Date(v.timestamp).toLocaleDateString()} | Type: ${v.contentType} | Action: ${v.action}\nRule: ${v.rule || 'None'}\nMod: ${v.modName}\n`).join('\n')
            },
            {
              name: 'modNote',
              label: 'Mod Note',
              type: 'paragraph',
              defaultValue: note || 'No note.',
              disabled: true
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
      `#${i + 1} u/${u.userName} - ${u.count} violation${u.count !== 1 ? 's' : ''} (Tier ${u.tier})`).join('\n');

  return c.json<UiResponse>({
    showForm: {
      name: 'dashboard',
      form: {
        title: 'OffenseLog Dashboard',
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

menu.post('/tier-override', async (c) => {
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

  const subreddit = await reddit.getCurrentSubreddit();
  const currentTier = await getCurrentTier(subreddit.id, authorId);

  return c.json<UiResponse>({
    showForm: {
      name: 'tierOverride',
        form: {
          title: `Override Tier: u/${authorName}`,
          description: `Current tier: ${currentTier}`,
          fields: [
            { name: 'authorId', type: 'string', label: 'User ID', defaultValue: authorId, disabled: true },
            { name: 'authorName', type: 'string', label: 'Username', defaultValue: authorName, disabled: true },
            { name: 'newTier', type: 'number', label: 'New tier (0–3)' },
          ],
          acceptLabel: 'Override',
          cancelLabel: 'Cancel',
      },
    },
  }, 200)
});


menu.post('/delete-violation', async (c) => {
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

  const subreddit = await reddit.getCurrentSubreddit();
  const decayWindowDays = Number(await settings.get('decayWindowDays')) || 30;
  const active = await getActiveViolations(authorId, subreddit.id, decayWindowDays);

  const listText = active.length === 0
    ? 'No active violations.'
    : active.map((v, i) =>
        `#${i + 1} - ${new Date(v.timestamp).toLocaleDateString()} | ${v.contentType} | ${v.action}\nRule: ${v.rule || 'None'} | Mod: ${v.modName}`).join('\n\n');

  return c.json<UiResponse>({
    showForm: {
      name: 'deleteViolation',
      form: {
        title: `Delete Violation: u/${authorName}`,
        description: `${active.length} active violation${active.length !== 1 ? 's' : ''}`,
        fields: [
          { name: 'authorId', type: 'string', label: 'User ID', defaultValue: authorId, disabled: true },
          { name: 'authorName', type: 'string', label: 'Username', defaultValue: authorName, disabled: true },
          { name: 'list', type: 'paragraph', label: 'Active Violations', defaultValue: listText },
          { name: 'violationIndex', type: 'number', label: 'Violation # to delete' },
        ],
        acceptLabel: 'Delete',
        cancelLabel: 'Cancel'
      },
    },
  }, 200);
});


menu.post('/edit-note', async (c) => {
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

    const subreddit = await reddit.getCurrentSubreddit();
    const currentNote = await getModNote(subreddit.id, authorId);

    return c.json<UiResponse>({
      showForm: {
        name: 'editNote',
        form: {
          title: `Edit Mod Note: u/${authorName}`,
          description: 'Add or update a sticky note visible to all mods.',
          fields: [
            { name: 'authorId', type: 'string', label: 'User ID', defaultValue: authorId, disabled: true },
            { name: 'authorName', type: 'string', label: 'Username', defaultValue: authorName, disabled: true },
            { name: 'note', type: 'paragraph', label: 'Note (leave blank to clear)', defaultValue: currentNote },
          ],
          acceptLabel: 'Save',
          cancelLabel: 'Cancel'
        },
      },
    }, 200);
});