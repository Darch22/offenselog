import { redis } from "@devvit/redis";


export interface Violation {
    id: string;
    contentId: string;
    contentType: 'post' | 'comment';
    action: string;
    modId: string;
    modName: string;
    targetUserId: string;
    targetUserName: string;
    timestamp: number;
}


function violationKey(subredditId: string, userId: string) : string {
    return `violations:${subredditId}:${userId}`;
}


export async function addViolation(
    subredditId: string,
    violation: Violation
): Promise<boolean> {
    const key = violationKey(subredditId, violation.targetUserId);

    
    const windowStart = violation.timestamp - 5000;
    const recentEntries = await redis.zRange(key, windowStart, violation.timestamp, {by: 'score'});

    const isDuplicate = recentEntries.some((entry) => {
        const parsed = JSON.parse(entry.member) as Violation;
        return parsed.contentId === violation.contentId;
    });

    if (isDuplicate) {
        return false;
    }

    await redis.zAdd(key, {
        score: violation.timestamp,
        member: JSON.stringify(violation)
    })
    
    return true;
}