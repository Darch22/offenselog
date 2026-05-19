# OffenseLog

A Reddit moderation tool built with Devvit that automatically tracks user rule violations and enforces a configurable tiered escalation system — warning, temp banning, and permanently banning users as their violations accumulate.

## What It Does

OffenseLog listens for mod actions in real time. Every time a moderator removes a post or comment, the violation is logged against that user. As violations stack up within a configurable time window, the app automatically escalates consequences: a warning DM, then a temporary ban, then a permanent ban. When violations decay past the window or content is re-approved, the user's standing is updated accordingly.

Moderators never have to count violations manually or remember who got warned last month.

## Features

- **Automatic Violation Logging**: Captures `remove`, `spam` mod actions on posts and comments the moment they happen
- **Re-approval Handling**: Approving previously removed content automatically removes that violation from the user's record
- **Rule Association**: When a removal reason is attached to content, it's stored alongside the violation for context
- **Tiered Escalation**:
  - **Tier 1** — Warning DM sent to the user
  - **Tier 2** — Temporary ban (configurable duration)
  - **Tier 3** — Permanent ban
- **De-escalation**: Tier is recalculated on every mod action; if active violations drop, the tier drops with them
- **Modmail Notifications**: A modmail notification is posted to the mod team on every tier escalation
- **AutoModerator Ignored**: Actions taken by AutoModerator are never logged
- **Mod-on-Mod Protection**: Actions against fellow moderators are never logged
- **Violation History Menu**: Click Mod actions on any post or comment to view that user's current tier, active violation count, and total violation history
- **Manual Reset**: Moderators can wipe a user's entire violation record and reset their tier to 0 from the same context menu
- **Violation Decay**: Violations older than the configured window are automatically excluded from tier calculations
- **Daily Cleanup**: A scheduled task runs every night at 4 AM to prune expired violations from storage

## Tech Stack

- [Devvit](https://developers.reddit.com/): Reddit's platform for building and deploying apps
- [Hono](https://hono.dev/): Lightweight web framework for routing internal endpoints
- [Vite](https://vite.dev/): Build tool for the server bundle
- [TypeScript](https://www.typescriptlang.org/): Type-safe development
- [Redis](https://developers.reddit.com/docs/redis): Sorted set storage for time-ordered violation records

## Getting Started

1. **Clone the repository**
2. **Install dependencies**:
   ```bash
   npm install
   ```
3. **Configure your app** in `devvit.json`:
   - Update the `name` field to your app name
   - Set your `dev.subreddit` to your development subreddit
4. **Log in to Devvit**:
   ```bash
   npm run login
   ```
5. **Start playtesting**:
   ```bash
   npm run dev
   ```
6. **Test in your development subreddit** — remove a post or comment and watch the violation get logged

## Project Structure

```
src/
├── index.ts                        # App entry point; mounts all route groups
├── core/
│   ├── violations.ts               # Redis CRUD for violation records and tier state
│   └── escalation.ts               # Tier threshold checks and enforcement actions
└── routes/
    ├── api.ts                      # Public API endpoints (extendable)
    ├── forms.ts                    # Form submission handlers (view history, reset)
    ├── menu.ts                     # Context menu handlers (view/reset violations)
    ├── scheduler.ts                # Nightly decay cleanup task
    └── triggers.ts                 # onAppInstall and onModAction event handlers
```

## Configuration

All settings are configurable per-subreddit from the app's settings page after installation:

| Setting | Label | Default | Description |
|---|---|---|---|
| `tier1Threshold` | Tier 1 threshold (warning) | `3` | Active violations needed to trigger a warning DM |
| `tier2Threshold` | Tier 2 threshold (temp ban) | `5` | Active violations needed to trigger a temp ban |
| `tier3Threshold` | Tier 3 threshold (perma ban) | `8` | Active violations needed to trigger a permanent ban |
| `decayWindowDays` | Violation decay window (days) | `30` | How many days back to count violations as "active" |
| `tier2BanDuration` | Tier 2 temp ban duration (days) | `14` | Length of the temporary ban at Tier 2 |
| `warningMessage` | Warning DM message | *(see devvit.json)* | Message body sent to the user at Tier 1 |
| `banMessage` | Ban message | *(see devvit.json)* | Message body included in the ban at Tier 2/3 |

## How It Works

### Violation Tracking

Every mod action triggers the `onModAction` handler. When the action is a removal (`removelink`, `removecomment`, `spamlink`, `spamcomment`), OffenseLog records a `Violation` object in Redis as a sorted set entry, scored by timestamp. This enables efficient time-range queries for the decay window.

A 5-second deduplication window prevents the same piece of content from being logged twice in quick succession.

### Tier Calculation

After every mod action, the number of active violations (those within the decay window) is counted. The result is compared against the configured thresholds:

```
activeCount >= tier3Threshold  →  Tier 3 (permanent ban)
activeCount >= tier2Threshold  →  Tier 2 (temp ban)
activeCount >= tier1Threshold  →  Tier 1 (warning DM)
activeCount < tier1Threshold   →  Tier 0 (no action)
```

Escalation only fires when the new tier is **higher** than the user's current stored tier. De-escalation (tier dropping) is tracked silently — no action is taken on the user, but the stored tier is updated so future escalations trigger correctly.

A modmail notification is sent to the mod team on every escalation event.

### Re-approval

If a moderator approves content that previously triggered a violation (`approvelink`, `approvecomment`), that violation is removed from the user's record and the tier is recalculated immediately.

### Removal Reason Attachment

When a mod adds a removal reason to content (`addremovalreason`), OffenseLog finds the matching violation record and updates its `rule` field so the history view shows which rule was broken.

### Decay Cleanup

A scheduled cron task runs daily at 4:00 AM. It iterates all users who have ever had a violation in the subreddit and removes any violation entries older than the configured `decayWindowDays`. Users with no remaining violations are removed from the active-users index and their tier is reset to 0.

### Context Menu

Moderators see two items on every post and comment:

- **View Violation History** — Opens a read-only form showing the user's current tier, active violation count, total violation count, and a list of recent violations with content type, action, rule, date, and acting moderator.
- **Reset Violation History** — Opens a confirmation form. On accept, all violations are deleted from Redis and the user's tier is set back to 0.

## Commands

| Command | Description |
|---|---|
| `npm run dev` | Starts Devvit playtest mode with live reload on your test subreddit |
| `npm run build` | Builds the app for production |
| `npm run deploy` | Type-checks, lints, tests, and uploads a new version to Reddit |
| `npm run launch` | Deploys and submits the app for Reddit's public app review |
| `npm run login` | Authenticates the Devvit CLI with your Reddit account |
| `npm run type-check` | Runs TypeScript compilation |
| `npm run lint` | Runs ESLint across all source files |
| `npm run test` | Runs the Vitest test suite |

## Deployment

1. Test thoroughly in your development subreddit using `npm run dev`
2. Run `npm run deploy` to upload a new version
3. Install the app on your target subreddit from the Devvit app directory
4. Configure thresholds and decay window from the subreddit's app settings page
5. Run `npm run launch` when ready to submit for Reddit's public app review

## Permissions

The app requires `reddit: true` to access Reddit's API (ban users, send DMs, post modmail, read posts and comments). All menu items are restricted to the `moderator` user type.
