import { reddit } from "@devvit/web/server";
import { settings } from "@devvit/web/server";

export async function checkEscalation(
    activeCount: number,
    currentTier: number,
    userId: string,
    userName: string,
    subredditId: string,
    subredditName: string
): Promise<number> {

    const tier1Threshold = Number(await settings.get('tier1Threshold')) || 3;
    const tier2Threshold = Number(await settings.get('tier2Threshold')) || 5;
    const tier3Threshold = Number(await settings.get('tier3Threshold')) || 8;
    const banDuration = Number(await settings.get('tier2BanDuration')) || 14;
    const warningMessage = String(await settings.get('warningMessage')) || 'You have received multiple content removals. Please review the community rules.';
    const banMessage = String(await settings.get('banMessage')) || 'You have been banned due to repeated rule violations.';

    let newTier = 0;

    if(activeCount >= tier3Threshold) newTier = 3;
    else if (activeCount >= tier2Threshold) newTier = 2;
    else if (activeCount >= tier1Threshold) newTier = 1;



    if (newTier > currentTier) {
        if (newTier === 1) {
            await reddit.sendPrivateMessage({
                to: userName,
                subject: `Warning from r/${subredditName}`,
                text: warningMessage
            })
        } else if (newTier === 2) {
            await reddit.banUser({
                username: userName,
                subredditName: subredditName,
                context: 'Temp Ban',
                message: banMessage,
                reason: 'Repeated violations',
                duration: banDuration
            })
        } else if (newTier === 3) {
            await reddit.banUser({
                username: userName,
                subredditName: subredditName,
                context: 'Permanent Ban',
                message: banMessage,
                reason: 'Repeated violations',
            })
        }

        await reddit.modMail.createModNotification({
            subredditId: subredditId as `t5_${string}`,
            subject: `[OffenseLog] Tier ${newTier} escalation: u/${userName}`,
            bodyMarkdown: `**u/${userName}** has reached **${activeCount} active violations** and has been escalated to **Tier ${newTier}**.
            \n\nAction taken: ${newTier === 1 ? 'Warning DM' : newTier === 2 ? '14-day temp ban' : 'Permanent ban'}`,
        })
    }

    return newTier;

}