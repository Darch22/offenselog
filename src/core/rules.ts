import type { Violation } from "./violations";

export function parseWhitelist(
    raw: string
): Set<string> {
    if (!raw) return new Set();

    return new Set(
        raw.split('\n')
        .map(line => line.trim().toLowerCase())
        .filter(line => line.length > 0)
    );
}

export function parseWeights(
    raw: string
): Map<string, number> {
    const weights = new Map<string, number>();

    if (!raw) return weights;

    for (const line of raw.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        const colonIdx = trimmed.lastIndexOf(':');
        if (colonIdx === -1) continue;

        const name = trimmed.slice(0, colonIdx).trim().toLowerCase();
        const weight = Number(trimmed.slice(colonIdx + 1).trim());

        if (name && !isNaN(weight) && weight >= 0) {
            weights.set(name, weight);
        }
    }

    return weights;
}

export function getViolationWeight(
    rule: string,
    whitelist: Set<string>,
    weights: Map<string, number>
): number {
    const key = (rule ?? '').trim().toLowerCase();
    if (!key) return 1;

    if (whitelist.has(key)) return 0;

    return weights.get(key) ?? 1;
}

export function computeWeightedScore(
    violations: Violation[],
    whitelist: Set<string>,
    weights: Map<string, number>
): number {
    return violations.reduce(
        (sum, v) => sum + getViolationWeight(v.rule, whitelist, weights),
        0
    );
}