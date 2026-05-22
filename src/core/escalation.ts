import { reddit } from "@devvit/web/server";


export function computeNewTier(
    activeCount: number,
    tier1Threshold: number,
    tier2Threshold: number,
    tier3Threshold: number
): number {
    if (activeCount >= tier3Threshold) return 3;
    if (activeCount >= tier2Threshold) return 2;
    if (activeCount >= tier1Threshold) return 1;
    return 0;
}

export async function applyEscalation(
    newTier: number,
    activeCount: number,
    userName: string,
    subredditId: string,
    subredditName: string,
    banDuration: number,
    warningMessage: string,
    banMessage: string,
    dryRun: boolean,
    modmailLevel: string
): Promise<void> {
    if (!dryRun) {
        if (newTier === 1) {
            try {
                await reddit.sendPrivateMessage({
                        to: userName,
                        subject: `Warning from r/${subredditName}`,
                        text: warningMessage
                    });
            } catch (err) {
                console.error('Failed to send warning DM', err);
            }
        } else if (newTier === 2) {
            try {
                    await reddit.banUser({
                        username: userName,
                        subredditName: subredditName,
                        context: 'Temp Ban',
                        message: banMessage,
                        reason: `Automated: ${activeCount} violations (Tier 2)`,
                        duration: banDuration
                    })
                } catch(err) {
                    console.error('Failed to temp ban:', err);
                }
        } else if (newTier === 3) {
            try {
                await reddit.banUser({
                    username: userName,
                    subredditName: subredditName,
                    context: 'Permanent Ban',
                    message: banMessage,
                    reason: `Automated: ${activeCount} violations (Tier 3)`,
                })
            } catch(err) {
                console.error('Failed to perma ban:', err);
            }
        }
    }

    const shouldNotify = modmailLevel === 'all' || (modmailLevel === 'bans' && newTier >= 2);

    if (shouldNotify) {
        try {
            await reddit.modMail.createModNotification({
                subredditId: subredditId as `t5_${string}`,
                subject: `[OffenseLog${dryRun ? ' DRY RUN' : ''}] Tier ${newTier} escalation: u/${userName}`,
                bodyMarkdown: `${dryRun ? '**DRY RUN - no action was taken.**\n\n' : ''}**u/${userName}** has reached **${activeCount} active violations** and has been escalated to **Tier ${newTier}**.\n\nAction taken: ${newTier === 1 ? 'Warning DM' : newTier === 2 ? `${banDuration}-day temp ban` : 'Permanent ban'}`,
            })
        } catch(err) {
            console.error('Failed to send modmail notification:', err);
        }
    }
    
}