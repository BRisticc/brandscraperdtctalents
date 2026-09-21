/**
 * Brand name → brand site.
 *
 * When the run starts from a name rather than a page, everything downstream
 * needs a domain: the profiler needs somewhere to fetch, and the dork builder
 * needs it both as a search term and as the `-site:` that keeps the brand's
 * own marketing out of its own attribution results.
 *
 * One plain query per brand is enough — the official site is what an engine
 * is best at — so this deliberately spends no dork budget on it.
 */

import { hostOf, isDeniedDomain, registrableDomain } from '../util/domain.js';
import { normalise } from '../util/text.js';
import { isPlatformHost } from './claimants.js';
import type { DorkQuery } from './dorks.js';
import type { SerpProvider, SerpResult } from './serp.js';

export interface ResolvedBrand {
    name: string;
    url?: string;
    domain?: string;
    /** 0-100 confidence that this really is the brand's own site. */
    confidence: number;
    note?: string;
}

/** Builds the lookup query for one brand name. */
export function resolutionQuery(name: string, index: number): DorkQuery {
    return {
        id: `resolve-${index}`,
        tier: 'core',
        surface: 'web',
        intent: 'portfolio',
        query: `"${name.replace(/"/g, '')}" official site`,
        weight: 100,
    };
}

/**
 * Scores a candidate result as "this is the brand's own homepage".
 *
 * The domain containing the squashed brand name is the dominant signal; rank
 * only breaks ties. Retailers and marketplaces stock brands without being
 * them, so the shared denylist does most of the negative work.
 */
export function scoreBrandSite(result: SerpResult, name: string): number {
    const domain = registrableDomain(result.url);
    if (!domain) return -1;
    if (isPlatformHost(domain) || isDeniedDomain(domain)) return -1;

    const squashed = normalise(name).replace(/[^a-z0-9]/g, '');
    const stem = (domain.split('.')[0] ?? '').replace(/[^a-z0-9]/g, '');
    if (!squashed || !stem) return -1;

    let score = 30;
    if (stem === squashed) score += 50;
    else if (stem.includes(squashed) || squashed.includes(stem)) score += 30;
    else if (!normalise(result.title).includes(normalise(name))) score -= 20;

    // A homepage, not a deep article about the brand.
    const path = hostOf(result.url) ? new URL(result.url).pathname : '/';
    if (path === '/' || path === '') score += 12;
    else if (path.split('/').filter(Boolean).length > 2) score -= 8;

    score -= Math.min(10, Math.max(0, result.position - 1) * 2);
    return score;
}

/**
 * Resolves a list of brand names to their own sites in one batched SERP call.
 * A name that cannot be resolved comes back with no URL and a note, never
 * dropped — the caller can still attribute it by name alone.
 */
export async function resolveBrandSites(
    names: string[],
    provider: SerpProvider,
    opts: { country?: string; language?: string },
): Promise<ResolvedBrand[]> {
    const wanted = names.map((n) => n.trim()).filter(Boolean);
    if (wanted.length === 0) return [];

    const queries = wanted.map((name, index) => resolutionQuery(name, index));
    const results = await provider.search(queries, {
        resultsPerQuery: 5,
        ...(opts.country ? { country: opts.country } : {}),
        ...(opts.language ? { language: opts.language } : {}),
    });

    const byQueryId = new Map<string, SerpResult[]>();
    for (const result of results) {
        const bucket = byQueryId.get(result.queryId) ?? [];
        bucket.push(result);
        byQueryId.set(result.queryId, bucket);
    }

    return wanted.map((name, index) => {
        const bucket = byQueryId.get(`resolve-${index}`) ?? [];
        let best: { result: SerpResult; score: number } | undefined;
        for (const result of bucket) {
            const score = scoreBrandSite(result, name);
            if (score < 0) continue;
            if (!best || score > best.score) best = { result, score };
        }

        if (!best || best.score < 40) {
            return {
                name,
                confidence: 0,
                note: bucket.length === 0
                    ? 'No search results for this brand name.'
                    : 'No result looked like the brand\'s own site; researching by name only.',
            };
        }

        const domain = registrableDomain(best.result.url);
        return {
            name,
            url: domain ? `https://${domain}` : best.result.url,
            ...(domain ? { domain } : {}),
            confidence: Math.min(100, best.score),
        };
    });
}
