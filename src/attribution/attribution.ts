/**
 * The attribution pipeline: brand name in, named operators out.
 *
 *   build dorks → run them → dedupe URLs → open the survivors →
 *   read who is claiming credit → group by claimant → rank by evidence
 *
 * The ranking is deliberately conservative. One LinkedIn headline naming the
 * brand is a lead; the same agency turning up in an open media plan, a case
 * study and a Clutch roster is an answer. Cross-surface corroboration is
 * therefore worth more than any single strong hit.
 */

import { log } from 'apify';
import { registrableDomain } from '../util/domain.js';
import { mapWithConcurrency, type FetchOptions } from '../util/http.js';
import { truncate, uniq } from '../util/text.js';
import {
    brandAliases, buildDorks, surfaceByKey, type DorkQuery, type DorkTier,
} from './dorks.js';
import { claimantFromUrl, claimantsFromText, mergeClaimant, type Claimant } from './claimants.js';
import { dedupeHarvest, documentIdentity, surfaceForDocumentUrl, type HarvestedLink } from './link-harvest.js';
import type { SerpProvider, SerpResult } from './serp.js';
import { verifyHit, type ClaimEvidence } from './verify.js';

/** One operator, with everything that ties them to the brand. */
export interface AgencyClaim {
    claimant: Claimant;
    /** 0-100. Best single piece of evidence, lifted by corroboration. */
    score: number;
    /** Distinct surfaces this claimant was found on. */
    surfaces: string[];
    /** Result claims found on their pages. */
    metrics: string[];
    /** Roles they describe themselves as. */
    roles: string[];
    /** True when at least one page was opened and the brand confirmed in it. */
    verified: boolean;
    evidence: ClaimEvidence[];
}

export interface AgencyAttribution {
    brand: string;
    aliases: string[];
    domain?: string;
    /** Every dork run, so a user can re-run one by hand. */
    queries: DorkQuery[];
    resultsSeen: number;
    resultsVerified: number;
    /** Documents reached by following links off the pages the dorks found. */
    documentsHarvested: number;
    claims: AgencyClaim[];
    /**
     * Pages that clearly discuss the brand commercially but name nobody we
     * could resolve. Usually worth a human glance — they are the leads the
     * machine could not close.
     */
    unattributed: ClaimEvidence[];
    warnings: string[];
}

export interface AttributionOptions {
    provider: SerpProvider;
    tiers: DorkTier[];
    extraSurfaces?: string[];
    excludeDomains?: string[];
    after?: string;
    before?: string;
    maxQueries: number;
    resultsPerQuery: number;
    /** Hard cap on pages actually opened. This is the real cost control. */
    maxPagesToVerify: number;
    /**
     * Documents to follow off the pages the dorks found. 0 turns the second
     * hop off; it is the main way to reach open Drive and Canva material,
     * which Google indexes only shallowly when it indexes it at all.
     */
    maxHarvestedPages: number;
    /** Extra hosts the second hop should treat as document hosts. */
    extraDocumentHosts?: string[];
    minClaimScore: number;
    country?: string;
    language?: string;
    concurrency: number;
    fetchOptions: FetchOptions;
}

export interface AttributionTarget {
    brand: string;
    domain?: string;
    extraAliases?: string[];
}

/** Ranks results before any page is opened, so the fetch budget is spent well. */
function preRank(result: SerpResult, dork: DorkQuery | undefined): number {
    const weight = dork?.weight ?? 50;
    return weight - Math.min(20, Math.max(0, result.position - 1) * 1.5);
}

/**
 * A document surface hides its author in the file, not the URL, so those hits
 * get the text pass even when the URL alone produced a plausible claimant.
 */
function needsTextClaimants(dork: DorkQuery): boolean {
    return dork.tier === 'docs' || Boolean(surfaceByKey(dork.surface)?.needsRewrite);
}

export async function researchAgencies(
    target: AttributionTarget,
    opts: AttributionOptions,
): Promise<AgencyAttribution> {
    const aliases = brandAliases(target.brand, target.domain, target.extraAliases ?? []);
    const warnings: string[] = [];

    const dorkTarget = {
        brand: target.brand,
        aliases: aliases.filter((a) => a !== target.brand),
        ...(target.domain ? { domain: target.domain } : {}),
    };
    const queries = buildDorks(dorkTarget, {
        tiers: opts.tiers,
        ...(opts.extraSurfaces ? { extraSurfaces: opts.extraSurfaces } : {}),
        ...(opts.excludeDomains ? { excludeDomains: opts.excludeDomains } : {}),
        ...(opts.after ? { after: opts.after } : {}),
        ...(opts.before ? { before: opts.before } : {}),
        maxQueries: opts.maxQueries,
    });

    const empty: AgencyAttribution = {
        brand: target.brand,
        aliases,
        ...(target.domain ? { domain: target.domain } : {}),
        queries,
        resultsSeen: 0,
        resultsVerified: 0,
        documentsHarvested: 0,
        claims: [],
        unattributed: [],
        warnings,
    };

    if (queries.length === 0) {
        warnings.push(`No dorks could be built for "${target.brand}" — the brand name is too short or empty.`);
        return empty;
    }

    const serpOptions = {
        resultsPerQuery: opts.resultsPerQuery,
        ...(opts.country ? { country: opts.country } : {}),
        ...(opts.language ? { language: opts.language } : {}),
    };
    // The provider explains its own failures; carry whatever it said during
    // THIS brand's search into this brand's row, so a dataset row is
    // self-diagnosing instead of pointing at a run-level report.
    const warningsBefore = opts.provider.warnings.length;
    const results = await opts.provider.search(queries, serpOptions);
    warnings.push(...opts.provider.warnings.slice(warningsBefore));
    empty.resultsSeen = results.length;

    if (results.length === 0) {
        const providerSpoke = opts.provider.warnings.length > warningsBefore;
        warnings.push(
            `No search results for "${target.brand}" across ${queries.length} dorks.`
            + (providerSpoke
                ? ' See the search-provider warning above for why.'
                : ' The provider reported no problem, so the queries themselves matched nothing —'
                  + ' try fewer tiers, a lower minClaimScore, or a wider date window.'),
        );
        return empty;
    }

    const byId = new Map(queries.map((q) => [q.id, q]));
    const ownDomains = uniq([
        ...(target.domain ? [target.domain] : []),
        ...(opts.excludeDomains ?? []),
    ].map((d) => d.toLowerCase().replace(/^www\./, '')));

    // Dedupe by URL, keeping the highest-weighted dork that found it: the same
    // agency page will surface for half a dozen queries.
    const bestByUrl = new Map<string, { result: SerpResult; dork: DorkQuery; rank: number }>();
    for (const result of results) {
        const domain = registrableDomain(result.url);
        if (!domain || ownDomains.includes(domain)) continue;
        if (/^(google|bing|duckduckgo)\./.test(domain)) continue;

        const dork = byId.get(result.queryId) ?? queries.find((q) => q.query === result.query);
        if (!dork) continue;

        const rank = preRank(result, dork);
        const existing = bestByUrl.get(result.url);
        if (!existing || rank > existing.rank) bestByUrl.set(result.url, { result, dork, rank });
    }

    const toVerify = [...bestByUrl.values()]
        .sort((a, b) => b.rank - a.rank)
        .slice(0, Math.max(1, opts.maxPagesToVerify));

    log.info(`  "${target.brand}": ${queries.length} dorks → ${results.length} results → ${bestByUrl.size} unique → opening ${toVerify.length}`);

    const evidence = await mapWithConcurrency(toVerify, Math.max(1, opts.concurrency), async (entry) => {
        const hit = await verifyHit(entry.result, entry.dork, {
            ...opts.fetchOptions,
            aliases,
            ...(opts.extraDocumentHosts ? { extraDocumentHosts: opts.extraDocumentHosts } : {}),
        });
        return { hit, dork: entry.dork };
    });

    // ---- second hop: follow the documents those pages link to -------------
    // Google indexes a Drive file only once something crawlable has linked it,
    // and then usually indexes little more than the title. Reading the links
    // off the pages we already opened reaches the same documents without
    // depending on how well Drive happens to be indexed.
    const harvested = await followDocumentLinks(evidence, {
        opts,
        aliases,
        alreadySeen: new Set([...bestByUrl.keys()].map(documentIdentity)),
    });
    evidence.push(...harvested);
    if (harvested.length > 0) {
        log.info(`  "${target.brand}": followed ${harvested.length} linked document(s)`);
    }

    // ---- group by claimant ------------------------------------------------
    const claims = new Map<string, AgencyClaim>();
    const unattributed: ClaimEvidence[] = [];

    for (const { hit, dork } of evidence) {
        const candidates: Claimant[] = [];

        const fromUrl = claimantFromUrl(hit.url, hit.title, ownDomains);
        if (fromUrl) candidates.push(fromUrl);
        if (hit.text && needsTextClaimants(dork)) {
            candidates.push(...claimantsFromText(hit.text, ownDomains).slice(0, 2));
        }

        if (candidates.length === 0) {
            // Only surface a dead end when the page was actually worth reading.
            if (hit.score >= opts.minClaimScore) unattributed.push(stripText(hit));
            continue;
        }

        for (const candidate of candidates) {
            const existing = claims.get(candidate.key);
            if (existing) {
                existing.claimant = mergeClaimant(existing.claimant, candidate);
                existing.evidence.push(stripText(hit));
            } else {
                claims.set(candidate.key, {
                    claimant: candidate,
                    score: 0,
                    surfaces: [],
                    metrics: [],
                    roles: [],
                    verified: false,
                    evidence: [stripText(hit)],
                });
            }
        }
    }

    const ranked = [...claims.values()].map((claim) => {
        const sorted = claim.evidence.sort((a, b) => b.score - a.score);
        const best = sorted[0]?.score ?? 0;
        const surfaces = uniq(sorted.map((e) => e.surfaceLabel));
        const tiers = uniq(sorted.map((e) => e.tier));
        const verified = sorted.some((e) => e.verified);

        // Corroboration, not volume: ten hits on one surface is one signal.
        const corroboration = Math.min(18, (surfaces.length - 1) * 6 + (tiers.length - 1) * 4);
        const score = Math.max(0, Math.min(100, Math.round(best + corroboration + (verified ? 0 : -12))));

        return {
            ...claim,
            evidence: sorted.slice(0, 12),
            surfaces,
            metrics: uniq(sorted.flatMap((e) => e.metrics)).slice(0, 10),
            roles: uniq(sorted.flatMap((e) => e.roles)).slice(0, 8),
            verified,
            score,
        };
    })
        .filter((claim) => claim.score >= opts.minClaimScore)
        .sort((a, b) => b.score - a.score || b.evidence.length - a.evidence.length);

    if (ranked.length === 0) {
        warnings.push(
            `Opened ${toVerify.length} page(s) for "${target.brand}" but none cleared minClaimScore `
            + `(${opts.minClaimScore}). Lower it, add the "wide" tier, or widen the date window.`,
        );
    }

    return {
        ...empty,
        resultsVerified: evidence.filter((e) => e.hit.verified).length,
        documentsHarvested: harvested.length,
        claims: ranked,
        unattributed: unattributed.sort((a, b) => b.score - a.score).slice(0, 15),
        warnings,
    };
}

/**
 * Page text and the harvested link list are working state: they exist to name
 * the claimant and to feed the second hop, and never reach the dataset.
 */
function stripText(hit: ClaimEvidence): ClaimEvidence {
    const { text, documentLinks, ...rest } = hit;
    void text;
    void documentLinks;
    return { ...rest, quote: truncate(rest.quote, 500) };
}

interface VerifiedHit {
    hit: ClaimEvidence;
    dork: DorkQuery;
}

/**
 * Opens the documents linked from the pages the dorks found.
 *
 * Each linked document is scored as its own surface — an open media plan is
 * worth what an open media plan is worth however it was reached — but it
 * still has to clear the same bar as everything else: opened, read, and the
 * brand confirmed in the body.
 */
async function followDocumentLinks(
    wave: VerifiedHit[],
    ctx: { opts: AttributionOptions; aliases: string[]; alreadySeen: Set<string> },
): Promise<VerifiedHit[]> {
    const budget = Math.max(0, ctx.opts.maxHarvestedPages);
    if (budget === 0) return [];

    const candidates: Array<HarvestedLink & { parent: ClaimEvidence }> = [];
    for (const { hit } of wave) {
        for (const url of hit.documentLinks ?? []) {
            const surface = surfaceForDocumentUrl(url, ctx.opts.extraDocumentHosts ?? []);
            if (!surface) continue;
            if (ctx.alreadySeen.has(documentIdentity(url))) continue;
            candidates.push({ url, surface, sourceUrl: hit.url, parent: hit });
        }
    }

    const targets = dedupeHarvest(candidates)
        .map((link) => candidates.find((c) => c.url === link.url))
        .filter((link): link is HarvestedLink & { parent: ClaimEvidence } => Boolean(link))
        // A document linked from a page that already scored well is a better
        // bet than one linked from a page that barely cleared the bar.
        .sort((a, b) => (b.parent.score - a.parent.score)
            || (surfaceByKey(b.surface)?.weight ?? 0) - (surfaceByKey(a.surface)?.weight ?? 0))
        .slice(0, budget);

    if (targets.length === 0) return [];

    return mapWithConcurrency(targets, Math.max(1, ctx.opts.concurrency), async (target) => {
        const surface = surfaceByKey(target.surface);
        const dork: DorkQuery = {
            id: 'hop',
            tier: 'docs',
            surface: target.surface,
            // The parent found it while looking for something; a document
            // linked from that page is work product until proven otherwise.
            intent: 'internal-doc',
            query: `linked from ${target.sourceUrl}`,
            weight: surface?.weight ?? 70,
        };
        const hit = await verifyHit(
            {
                url: target.url,
                title: '',
                snippet: '',
                position: 1,
                queryId: target.parent.queryId,
                query: dork.query,
                engine: 'link-hop',
            },
            dork,
            { ...ctx.opts.fetchOptions, aliases: ctx.aliases, maxDocumentLinks: 0 },
        );
        hit.linkedFrom = target.sourceUrl;
        return { hit, dork };
    });
}
