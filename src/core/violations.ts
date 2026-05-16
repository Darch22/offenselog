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

    await redis.zAdd(`active_users:${subredditId}`, {score: Date.now(), member: violation.targetUserId});
    
    return true;
}

export async function getViolations(
    userId: string,
    subredditId: string
) : Promise<Violation[]> {

    const key = violationKey(subredditId, userId);

    const entries = await redis.zRange(key, 0, -1);
    const violations: Violation[] = entries.map((entry) => JSON.parse(entry.member) as Violation)

    return violations;
}

export async function getActiveViolations(
    userId: string,
    subredditId: string,
    decayDays: number
): Promise<Violation[]> {
    const key = violationKey(subredditId, userId);
    const startScore = Date.now() - decayDays * 24 * 60 * 60 * 1000;
    const endScore = Date.now();

    const entries = await redis.zRange(key, startScore, endScore, {by: 'score'});
    const violations: Violation[] = entries.map((entry) => JSON.parse(entry.member) as Violation)

    return violations;
}

export async function removeViolation(
    subredditId: string,
    userId: string,
    contentId: string
): Promise<boolean> {
    const key = violationKey(subredditId, userId);

    const entries = await redis.zRange(key, 0, -1);
    
    for (const entry of entries) {
        const parsed = JSON.parse(entry.member) as Violation;
        if(parsed.contentId === contentId) {
            await redis.zRem(key, [entry.member]);
            return true;
        }
    } 

    return false;
}

export async function getCurrentTier(
    subredditId: string,
    userId: string
): Promise<number> {

    const value = await redis.get(`tier:${subredditId}:${userId}`);
    return value ? parseInt(value) : 0;
}

export async function setCurrentTier(
    subredditId: string,
    userId: string, 
    tier: number
): Promise<void> {
    await redis.set(`tier:${subredditId}:${userId}`, tier.toString());
}