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


    let newTier = 0;

    if(activeCount >= tier3Threshold) newTier = 3;
    else if (activeCount >= tier2Threshold) newTier = 2;
    else if (activeCount >= tier1Threshold) newTier = 1;



    if (newTier > currentTier) {
        if (newTier === 1) {
            try {
                await reddit.sendPrivateMessage({
                    to: userName,
                    subject: `Warning from r/${subredditName}`,
                    text: `Hi u/${userName},\n\nYou have had ${activeCount} post/comment removal(s) in 
                    r/${subredditName} within the past 30 days.\n\nPlease review the community rules at 
                    r/${subredditName}/about/rules to avoid further action.\n\nContinued violations may result in a temporary or permanent ban.`
                })
            } catch(err) {
                console.error('Failed to send warning DM:', err);
            }
        } else if (newTier === 2) {
            try {
                    await reddit.banUser({
                    username: userName,
                    subredditName: subredditName,
                    context: 'Temp Ban',
                    message: `You have been temporarily banned from r/${subredditName} for ${banDuration} days due to 
                    ${activeCount} rule violations.\n\nPlease review the community rules at r/${subredditName}/about/rules before your ban expires.`,
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
                    message: `You have been permanently banned from r/${subredditName} due to ${activeCount} rule violations.
                    \n\nIf you believe this is an error, you may contact the mod team via modmail.`,
                    reason: `Automated: ${activeCount} violations (Tier 3)`,
                })
            } catch(err) {
                console.error('Failed to perma ban:', err);
            }
        }

        try {
            await reddit.modMail.createModNotification({
                subredditId: subredditId as `t5_${string}`,
                subject: `[OffenseLog] Tier ${newTier} escalation: u/${userName}`,
                bodyMarkdown: `**u/${userName}** has reached **${activeCount} active violations** and has been escalated to **Tier ${newTier}**.
                \n\nAction taken: ${newTier === 1 ? 'Warning DM' : newTier === 2 ? '14-day temp ban' : 'Permanent ban'}`,
            })
        } catch(err) {
            console.error('Failed to send modmail notification:', err);
        }
    }

    return newTier;

}