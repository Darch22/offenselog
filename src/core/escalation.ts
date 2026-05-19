import { reddit } from "@devvit/web/server";
import { settings } from "@devvit/web/server";

export async function checkEscalation(
    activeCount: number,
    currentTier: number,
    _userId: string,
    userName: string,
    subredditId: string,
    subredditName: string
): Promise<number> {

    const tier1Threshold = Number(await settings.get('tier1Threshold')) || 3;
    const tier2Threshold = Number(await settings.get('tier2Threshold')) || 5;
    const tier3Threshold = Number(await settings.get('tier3Threshold')) || 8;
    const banDuration = Number(await settings.get('tier2BanDuration')) || 14;
    const warningMessage = String(await settings.get('warningMessage')) || 'You have received multiple content removals. Please review the community rules.';
    const banMessage = String(await settings.get('banMessage')) || 'You have been banned due to rule violations.';
    const dryRun = Boolean(await settings.get('dryRun'));


    let newTier = 0;

    if(activeCount >= tier3Threshold) newTier = 3;
    else if (activeCount >= tier2Threshold) newTier = 2;
    else if (activeCount >= tier1Threshold) newTier = 1;



    if (newTier > currentTier) {
        if (newTier === 1) {
            if(!dryRun) {
                try {
                    await reddit.sendPrivateMessage({
                        to: userName,
                        subject: `Warning from r/${subredditName}`,
                        text: warningMessage
                    })
                } catch(err) {
                    console.error('Failed to send warning DM:', err);
                }
            }
        } else if (newTier === 2) {
            if(!dryRun) {
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
            }
        } else if (newTier === 3) {
            if(!dryRun) {
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

    return newTier;

}