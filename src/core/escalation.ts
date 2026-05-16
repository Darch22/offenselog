import { reddit } from "@devvit/web/server";

export async function checkEscalation(
    activeCount: number,
    currentTier: number,
    userId: string,
    userName: string,
    subredditId: string,
    subredditName: string
): Promise<number> {

    let newTier = 0;

    if(activeCount >= 8) newTier = 3;
    else if (activeCount >= 5) newTier = 2;
    else if (activeCount >= 3) newTier = 1;


    if (newTier > currentTier) {
        if (newTier === 1) {
            await reddit.sendPrivateMessage({
                to: userName,
                subject: `Warning from r/${subredditName}`,
                text: 'This is a warning'
            })
        } else if (newTier === 2) {
            await reddit.banUser({
                username: userName,
                subredditName: subredditName,
                context: 'Temp Ban',
                message: `You are temperarily banned from r/${subredditName}`,
                reason: 'Hate speech',
                duration: 14,
            })
        } else if (newTier === 3) {
            await reddit.banUser({
                username: userName,
                subredditName: subredditName,
                context: 'Permanent Ban',
                message: `You are permanently banned from r/${subredditName}`,
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