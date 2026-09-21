/**
 * Verification.
 *
 * A SERP snippet is a claim about a page, not the page. Google will return a
 * result for `"My Patriot Supply" "case study"` because both strings appear
 * two thousand words apart in a listicle. Nothing downstream should treat a
 * snippet as attribution, so every surviving result is opened, the brand
 * mention is confirmed in the body, and the sentence around it is kept as the
 * quote a human will actually read before believing any of this.
 */

import { htmlToText, load } from '../util/html.js';
import { fetchPage, type FetchOptions } from '../util/http.js';
import { collapseWhitespace, countTerm, normalise, truncate, uniq } from '../util/text.js';
import { CLAIM_TERMS, surfaceByKey, type DorkIntent, type DorkQuery, type DorkTier } from './dorks.js';
import { harvestDocumentLinks } from './link-harvest.js';
import { isBinaryContentType, readableUrl } from './readable.js';
import type { SerpResult } from './serp.js';

/** One page that names the brand alongside somebody claiming credit for it. */
export interface ClaimEvidence {
    url: string;
    title: string;
    snippet: string;
    surface: string;
    surfaceLabel: string;
    tier: DorkTier;
    intent: DorkIntent;
    queryId: string;
    query: string;
    /** True when the page body was fetched and the brand found in it. */
    verified: boolean;
    /** The sentence the brand appears in. The thing a human checks. */
    quote: string;
    /** Result claims found near the brand, e.g. "4.2x ROAS", "$1.4M/mo". */
    metrics: string[];
    /** Role words present on the page: "media buyer", "creative strategist". */
    roles: string[];
    /** Which claim vocabularies fired. */
    claimPhrases: string[];
    /** 0-100. Surface × proximity × evidence density. */
    score: number;
    /** Why the page could not be read, when it could not. */
    note?: string;
    /** Plain text of the page, kept only long enough to identify the claimant. */
    text?: string;
    /**
     * Document links found on the page, kept only long enough for the second
     * hop to follow them. Stripped before anything reaches the dataset.
     */
    documentLinks?: string[];
    /** Set when this hit was reached by following a link rather than a dork. */
    linkedFrom?: string;
}

const METRIC_PATTERNS: RegExp[] = [
    /\b\d+(?:\.\d+)?\s*x\s*(?:blended\s+)?roas\b/gi,
    /\broas\s*(?:of|:|=)?\s*\d+(?:\.\d+)?x?\b/gi,
    /\b(?:cpa|cac|cpm|cpc|aov|mer)\s*(?:of|:|=)?\s*\$?\s?\d[\d,.]*\b/gi,
    /\$\s?\d[\d,.]*\s*(?:k|m|mm|bn|million|billion)?\s*(?:\/|\s+per\s+|\s+a\s+)\s*(?:day|week|month|mo|quarter|year)\b/gi,
    /\$\s?\d[\d,.]*\s*(?:k|m|mm|million|billion)\b/gi,
    /\b\d+(?:\.\d+)?%\s*(?:increase|lift|growth|improvement|drop|decrease|reduction|higher|lower|more)\b/gi,
    /\b(?:scaled|grew|took)\s+(?:them\s+)?from\s+\$?\s?\d[\d,.]*\w*\s+to\s+\$?\s?\d[\d,.]*\w*/gi,
    /\b(?:7|8|9)[-\s]?figure(?:s)?\b/gi,
];

/** The most a snippet-only hit can ever be worth. */
const UNVERIFIED_CEILING = 34;

const ALL_CLAIM_TERMS: Array<{ intent: DorkIntent; term: string }> = Object.entries(CLAIM_TERMS)
    .flatMap(([intent, terms]) => terms.map((term) => ({ intent: intent as DorkIntent, term })));

/** Splits an export/CSV payload into readable text without the markup pass. */
function plainToText(body: string, format: 'text' | 'csv'): string {
    if (format === 'csv') return collapseWhitespace(body.replace(/[,;"]+/g, ' '));
    return collapseWhitespace(body);
}

/** The window of text around the first brand mention, cut at sentence edges. */
export function quoteAround(text: string, aliases: string[], radius = 180): string {
    const haystack = text.toLowerCase();
    for (const alias of aliases) {
        const needle = alias.toLowerCase().trim();
        if (needle.length < 3) continue;
        const at = haystack.indexOf(needle);
        if (at < 0) continue;
        const start = Math.max(0, at - radius);
        const end = Math.min(text.length, at + needle.length + radius);
        const window = text.slice(start, end);
        return truncate(`${start > 0 ? '…' : ''}${window}${end < text.length ? '…' : ''}`, 2 * radius + 40);
    }
    return '';
}

export function extractMetrics(text: string): string[] {
    const found: string[] = [];
    for (const pattern of METRIC_PATTERNS) {
        for (const match of text.matchAll(pattern)) {
            const value = collapseWhitespace(match[0]);
            if (value) found.push(value);
            if (found.length >= 40) break;
        }
    }
    return uniq(found).slice(0, 12);
}

/** Claim vocabulary present in the text, reported as `intent:phrase`. */
export function extractClaimPhrases(normalisedText: string): Array<{ intent: DorkIntent; term: string }> {
    const hits: Array<{ intent: DorkIntent; term: string }> = [];
    for (const entry of ALL_CLAIM_TERMS) {
        if (countTerm(normalisedText, entry.term) > 0) hits.push(entry);
        if (hits.length >= 30) break;
    }
    return hits;
}

export interface VerifyOptions extends FetchOptions {
    aliases: string[];
    /** Read at most this many characters of each page. */
    maxChars?: number;
    /** Document links to collect per page for the second hop. */
    maxDocumentLinks?: number;
    /** Extra hosts to treat as document hosts when harvesting links. */
    extraDocumentHosts?: string[];
}

/**
 * Scores one piece of evidence.
 *
 * The surface sets the ceiling — an open media plan can be worth more than a
 * blog post no matter what either says — and everything else moves the number
 * inside it. An unverified hit is capped hard on purpose: a page we could not
 * open should never outrank one we read.
 */
export function scoreEvidence(input: {
    surfaceWeight: number;
    verified: boolean;
    brandInBody: boolean;
    metrics: number;
    roles: number;
    claimPhrases: number;
    intent: DorkIntent;
    position: number;
}): number {
    let score = input.surfaceWeight * 0.45;
    if (input.verified && input.brandInBody) score += 22;
    else if (input.verified) score -= 10;

    score += Math.min(14, input.metrics * 5);
    score += Math.min(10, input.roles * 4);
    score += Math.min(10, input.claimPhrases * 2);
    if (input.intent === 'internal-doc' || input.intent === 'contract') score += 6;
    if (input.intent === 'client-roster' || input.intent === 'case-study') score += 4;
    // Rank decays slowly: dorks are narrow enough that page-2 results matter.
    score -= Math.min(8, Math.max(0, input.position - 1) * 0.6);

    // The cap is applied last, deliberately. A page we could not open has a
    // snippet's worth of evidence however loudly that snippet reads, and must
    // never outrank a page we actually read.
    if (!input.verified) score = Math.min(score, UNVERIFIED_CEILING);

    return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Opens one SERP result and turns it into evidence.
 *
 * Never throws: a page that will not load still produces an unverified
 * `ClaimEvidence` carrying the reason, because "we looked and could not read
 * it" is information a human wants in the report.
 */
export async function verifyHit(result: SerpResult, dork: DorkQuery, opts: VerifyOptions): Promise<ClaimEvidence> {
    const surface = surfaceByKey(dork.surface);
    const surfaceWeight = surface?.weight ?? 60;
    const target = readableUrl(result.url);

    const base: ClaimEvidence = {
        url: result.url,
        title: result.title,
        snippet: result.snippet,
        surface: dork.surface,
        surfaceLabel: surface?.label ?? dork.surface,
        tier: dork.tier,
        intent: dork.intent,
        queryId: result.queryId,
        query: result.query || dork.query,
        verified: false,
        quote: '',
        metrics: [],
        roles: [],
        claimPhrases: [],
        score: 0,
    };

    let text = '';
    let documentLinks: string[] = [];
    try {
        const res = await fetchPage(target.url, opts);
        if (res.statusCode >= 400) {
            base.note = `HTTP ${res.statusCode} when opening ${target.rewritten ? 'the export URL' : 'the page'}.`;
        } else if (isBinaryContentType(res.contentType) && target.format === 'html') {
            base.note = `Not readable as text (${res.contentType.split(';')[0]}). Snippet only.`;
        } else if (target.format === 'html') {
            // One parse serves both jobs. Links are read first because
            // htmlToText strips the document as it goes.
            const $ = load(res.body);
            documentLinks = harvestDocumentLinks($, res.url || target.url, {
                max: opts.maxDocumentLinks ?? 25,
                extraHosts: opts.extraDocumentHosts ?? [],
            }).map((link) => link.url);
            text = htmlToText($);
            if (target.note) base.note = target.note;
        } else {
            text = plainToText(res.body, target.format);
            if (target.note) base.note = target.note;
        }
    } catch (err) {
        base.note = `Could not open: ${(err as Error).message}`;
    }

    const maxChars = opts.maxChars ?? 120_000;
    text = text.slice(0, maxChars);

    // Fall back to the snippet so an unreadable page is still scored on
    // something, just never as "verified".
    const corpus = text || `${result.title} ${result.snippet}`;
    const normalised = normalise(corpus);
    const brandInBody = opts.aliases.some((alias) => alias.length >= 3 && normalised.includes(normalise(alias)));

    const claimHits = extractClaimPhrases(normalised);
    const roles = uniq(claimHits.filter((h) => h.intent === 'role').map((h) => h.term));

    base.verified = text.length > 0;
    base.quote = quoteAround(corpus, opts.aliases) || truncate(result.snippet, 400);
    base.metrics = extractMetrics(corpus);
    base.roles = roles;
    base.claimPhrases = uniq(claimHits.map((h) => h.term)).slice(0, 12);
    base.score = scoreEvidence({
        surfaceWeight,
        verified: base.verified,
        brandInBody,
        metrics: base.metrics.length,
        roles: roles.length,
        claimPhrases: base.claimPhrases.length,
        intent: dork.intent,
        position: result.position,
    });
    if (text) base.text = text.slice(0, 20_000);
    if (documentLinks.length > 0) base.documentLinks = documentLinks;

    return base;
}
