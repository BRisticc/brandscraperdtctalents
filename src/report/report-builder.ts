import type { AgencyAttribution, AgencyClaim, BrandAttributionRow, RunReport } from '../types.js';
import { uniq } from '../util/text.js';

export function buildBrandRow(attribution: AgencyAttribution): BrandAttributionRow {
    const best = attribution.claims[0];
    const row: BrandAttributionRow = {
        brand: attribution.brand,
        aliases: attribution.aliases,
        operatorCount: attribution.claims.length,
        dorksRun: attribution.queries.length,
        resultsSeen: attribution.resultsSeen,
        documentsHarvested: attribution.documentsHarvested,
        pagesRead: attribution.resultsVerified,
        attribution,
        scrapedAt: new Date().toISOString(),
    };
    if (attribution.domain) row.domain = attribution.domain;
    if (best) {
        row.topOperator = best.claimant.name;
        row.topOperatorScore = best.score;
        row.topOperatorKind = best.claimant.kind;
    }
    return row;
}

/**
 * Rolls every brand's attribution up into one list of operators.
 *
 * Grouping happens on the claimant key rather than the display name, so the
 * same agency found as a LinkedIn company on one brand and as its own domain
 * on another still lands as two rows — deliberately. Collapsing them would
 * mean asserting an identity match the evidence does not support.
 */
export function buildOperatorLeaderboard(rows: BrandAttributionRow[]): RunReport['operatorLeaderboard'] {
    const out = new Map<string, RunReport['operatorLeaderboard'][number] & { brandSet: Set<string> }>();

    for (const row of rows) {
        for (const claim of row.attribution.claims as AgencyClaim[]) {
            const existing = out.get(claim.claimant.key);
            if (existing) {
                existing.brandSet.add(row.brand);
                existing.surfaces = uniq([...existing.surfaces, ...claim.surfaces]);
                existing.roles = uniq([...existing.roles, ...claim.roles]);
                existing.metrics = uniq([...existing.metrics, ...claim.metrics]).slice(0, 12);
                existing.bestScore = Math.max(existing.bestScore, claim.score);
                existing.evidenceCount += claim.evidence.length;
                continue;
            }
            out.set(claim.claimant.key, {
                name: claim.claimant.name,
                kind: claim.claimant.kind,
                ...(claim.claimant.profileUrl ? { profileUrl: claim.claimant.profileUrl } : {}),
                ...(claim.claimant.domain ? { domain: claim.claimant.domain } : {}),
                brands: [],
                brandSet: new Set([row.brand]),
                surfaces: claim.surfaces,
                roles: claim.roles,
                metrics: claim.metrics.slice(0, 12),
                bestScore: claim.score,
                evidenceCount: claim.evidence.length,
            });
        }
    }

    return [...out.values()]
        .map(({ brandSet, ...row }) => ({ ...row, brands: [...brandSet].sort() }))
        // An operator claiming several brands outranks one with a single
        // louder page: a repeated client roster is much harder to fake.
        .sort((a, b) => b.brands.length - a.brands.length || b.bestScore - a.bestScore)
        .slice(0, 200);
}

export function buildRunReport(
    rows: BrandAttributionRow[],
    meta: { serpProvider: string; warnings: string[] },
): RunReport {
    const leaderboard = buildOperatorLeaderboard(rows);
    return {
        generatedAt: new Date().toISOString(),
        brandsResearched: rows.length,
        dorksRun: rows.reduce((n, r) => n + r.dorksRun, 0),
        resultsSeen: rows.reduce((n, r) => n + r.resultsSeen, 0),
        documentsHarvested: rows.reduce((n, r) => n + r.documentsHarvested, 0),
        pagesRead: rows.reduce((n, r) => n + r.pagesRead, 0),
        operatorsFound: leaderboard.length,
        serpProvider: meta.serpProvider,
        operatorLeaderboard: leaderboard,
        warnings: meta.warnings,
        brands: rows,
    };
}
