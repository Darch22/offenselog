import { redis } from "@devvit/redis";


export interface Violation {
    id: string;
    contentId: string;
    contentType: 'post' | 'comment';
    action: string;
    rule: string;
    modId: string;
    modName: string;
    targetUserId: string;
    targetUserName: string;
    timestamp: number;
}

export async function clearViolations(subredditId: string, userId: string): Promise<void> {
    const key = violationKey(subredditId, userId);
    const entries = await redis.zRange(key, 0, -1);
    await redis.del(key);
    for (const entry of entries) {
        const parsed = JSON.parse(entry.member) as Violation;
        await redis.del(`content_violation:${subredditId}:${parsed.contentId}`);
    }
    await redis.del(`mod_note:${subredditId}:${userId}`);
    await redis.zRem(`active_users:${subredditId}`, [userId]);
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
    });

    
    await redis.set(`content_violation:${subredditId}:${violation.contentId}`, JSON.stringify(violation));
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
    const indexKey = `content_violation:${subredditId}:${contentId}`;

    const memberStr =await redis.get(indexKey);
    if(!memberStr) return false;

    await redis.zRem(key, [memberStr]);
    await redis.del(indexKey);

    const remaining = await redis.zCard(key);

    if (remaining === 0) {
        await redis.zRem(`active_users:${subredditId}`, [userId]);
    }

    return true;
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

export async function updateViolationRule(
    subredditId: string,
    userId: string,
    contentId: string,
    rule: string
): Promise<boolean> {
    const key = violationKey(subredditId, userId);
    const indexKey = `content_violation:${subredditId}:${contentId}`;

    const memberStr = await redis.get(indexKey);
    if (!memberStr) return false;

    const parsed = JSON.parse(memberStr) as Violation;
    parsed.rule = rule;
    const newMemberStr = JSON.stringify(parsed);

    await redis.zRem(key, [memberStr]);
    await redis.zAdd(key, {score: parsed.timestamp, member: newMemberStr});
    await redis.set(indexKey, newMemberStr);

    return true;
}

export async function claimEscalation(
    subredditId: string,
    userId: string,
    fromTier: number,
    toTier: number
): Promise<boolean> {
    const key = `esc_claim:${subredditId}:${userId}:${fromTier}->${toTier}`;
    const result = await redis.set(key, '1', {nx: true});
    return result !== null;
}

export async function releaseEscalation(
    subredditId: string,
    userId: string,
    fromTier: number,
    toTier: number
): Promise<void> {
    const key = `esc_claim:${subredditId}:${userId}:${fromTier}->${toTier}`;
    await redis.del(key);
}

export async function getTopOffenders(
    subredditId: string,
    days: number,
    limit: number
): Promise<Array<{userName: string; count: number; tier: number}>> {
    const allUsers = await redis.zRange(`active_users:${subredditId}`, 0, -1);
    if (allUsers.length === 0) return [];

    const candidates = [...allUsers]
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
        .slice(0, 50);

    const windowStart = Date.now() - days * 24 * 60 * 60 * 1000;
    const now = Date.now();

    const recentBatch = await Promise.all(
        candidates.map(entry => redis.zRange(violationKey(subredditId, entry.member), windowStart, now, {by: 'score'}))
    );

    const active = candidates.map((entry, i) => ({userId: entry.member, recent: recentBatch[i] ?? []}))
                             .filter(({recent}) => recent.length > 0);

    if (active.length === 0) return [];

    const tiers = await Promise.all(
        active.map(({userId}) => getCurrentTier(subredditId, userId))
    );

    return active
        .map(({recent}, i) => ({
            userName: (JSON.parse(recent[0]!.member) as Violation).targetUserName,
            count: recent.length,
            tier: tiers[i] ?? 0
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, limit);
}

export async function getModNote(
    subredditId: string,
    userId: string
): Promise<string> {
    const value = await redis.get(`mod_note:${subredditId}:${userId}`);
    return value ?? '';
}

export async function setModNote(
    subredditId: string,
    userId: string,
    note: string
): Promise<void> {
    const key = `mod_note:${subredditId}:${userId}`;

    if (note.trim()) {
        await redis.set(key, note);
    } else {
        await redis.del(key);
    }
}