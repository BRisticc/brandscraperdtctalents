import type { ProxyConfigurationOptions } from 'apify';
import { DORK_TIERS, type DorkTier } from './attribution/dorks.js';

export type SerpProviderName = 'auto' | 'apify-actor' | 'none';

export interface ActorInput {
    /** The brands to research. At least one is required. */
    brandNames: string[];
    /** Other names a brand answers to — house brands, handles, legal entities. */
    extraBrandAliases: string[];
    /** Skip resolving each name to its own site. Costs one query per brand. */
    resolveBrandSites: boolean;
    serpProvider: SerpProviderName;
    serpApifyActorId: string;
    serpApifyActorInput?: Record<string, unknown>;
    /** Dorks per nested SERP run. 1 isolates a failure to a single query. */
    serpBatchSize: number;
    serpCountry: string;
    serpLanguage: string;
    dorkTiers: DorkTier[];
    extraDorkSurfaces: string[];
    excludeDomains: string[];
    maxDorkQueries: number;
    resultsPerDork: number;
    maxClaimPagesPerBrand: number;
    maxHarvestedPages: number;
    extraDocumentHosts: string[];
    minClaimScore: number;
    dorkAfterDate?: string;
    dorkBeforeDate?: string;
    outputFormats: OutputFormat[];
    maxConcurrency: number;
    requestTimeoutSecs: number;
    maxRequestRetries: number;
    proxyConfiguration?: ProxyConfigurationOptions;
}

export type OutputFormat = 'json' | 'markdown' | 'html';

function asArray<T>(value: unknown, fallback: T[]): T[] {
    if (Array.isArray(value) && value.length > 0) return value as T[];
    return fallback;
}

function asInt(value: unknown, fallback: number, min: number, max: number): number {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, Math.round(parsed)));
}

function asEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
    return allowed.includes(value as T) ? (value as T) : fallback;
}

function asString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export class InputError extends Error {}

/**
 * Google's `before:`/`after:` take YYYY-MM-DD. Anything else is silently
 * ignored by the engine, which would quietly widen every query in the run, so
 * it is rejected here instead.
 */
function normaliseDorkDate(value: string, field: string): string {
    const match = /^\d{4}-\d{2}-\d{2}$/.exec(value.trim());
    if (!match) {
        throw new InputError(`${field} must be an ISO date like 2024-01-01, got "${value}".`);
    }
    return match[0];
}

/** Strips a pasted URL down to a bare host, so "https://coda.io/x" works too. */
function asHost(value: unknown): string {
    return String(value)
        .trim()
        .toLowerCase()
        .replace(/^https?:\/\//, '')
        .replace(/^www\./, '')
        .replace(/\/.*$/, '');
}

export function parseInput(raw: Record<string, unknown> | null): ActorInput {
    const input = raw ?? {};

    const brandNames = asArray<string>(input.brandNames, [])
        .map((name) => String(name).trim())
        .filter(Boolean);
    if (brandNames.length === 0) {
        throw new InputError('brandNames is required: give at least one brand to research.');
    }

    const outputFormats = asArray<string>(input.outputFormats, ['json', 'markdown', 'html'])
        .filter((f): f is OutputFormat => ['json', 'markdown', 'html'].includes(f));

    const parsed: ActorInput = {
        brandNames,
        extraBrandAliases: asArray<string>(input.extraBrandAliases, [])
            .map((a) => String(a).trim()).filter(Boolean),
        resolveBrandSites: input.resolveBrandSites !== false,
        serpProvider: asEnum(input.serpProvider, ['auto', 'apify-actor', 'none'] as const, 'auto'),
        serpApifyActorId: asString(input.serpApifyActorId) ?? 'apify/google-search-scraper',
        serpBatchSize: asInt(input.serpBatchSize, 20, 1, 100),
        serpCountry: (asString(input.serpCountry) ?? 'us').toLowerCase(),
        serpLanguage: (asString(input.serpLanguage) ?? 'en').toLowerCase(),
        dorkTiers: asArray<string>(input.dorkTiers, ['core', 'docs', 'social', 'directories'])
            .filter((tier): tier is DorkTier => (DORK_TIERS as readonly string[]).includes(tier)),
        extraDorkSurfaces: asArray<string>(input.extraDorkSurfaces, [])
            .map((s) => String(s).trim()).filter(Boolean),
        excludeDomains: asArray<string>(input.excludeDomains, []).map(asHost).filter(Boolean),
        maxDorkQueries: asInt(input.maxDorkQueries, 40, 1, 300),
        resultsPerDork: asInt(input.resultsPerDork, 10, 1, 100),
        maxClaimPagesPerBrand: asInt(input.maxClaimPagesPerBrand, 60, 1, 500),
        maxHarvestedPages: asInt(input.maxHarvestedPages, 40, 0, 300),
        extraDocumentHosts: asArray<string>(input.extraDocumentHosts, []).map(asHost).filter(Boolean),
        minClaimScore: asInt(input.minClaimScore, 45, 0, 100),
        outputFormats: outputFormats.length > 0 ? outputFormats : ['json', 'markdown', 'html'],
        maxConcurrency: asInt(input.maxConcurrency, 5, 1, 50),
        requestTimeoutSecs: asInt(input.requestTimeoutSecs, 30, 5, 300),
        maxRequestRetries: asInt(input.maxRequestRetries, 3, 0, 10),
    };

    if (parsed.dorkTiers.length === 0) parsed.dorkTiers = ['core', 'docs', 'social', 'directories'];

    const after = asString(input.dorkAfterDate);
    if (after) parsed.dorkAfterDate = normaliseDorkDate(after, 'dorkAfterDate');
    const before = asString(input.dorkBeforeDate);
    if (before) parsed.dorkBeforeDate = normaliseDorkDate(before, 'dorkBeforeDate');

    if (input.serpApifyActorInput && typeof input.serpApifyActorInput === 'object') {
        parsed.serpApifyActorInput = input.serpApifyActorInput as Record<string, unknown>;
    }
    if (input.proxyConfiguration && typeof input.proxyConfiguration === 'object') {
        parsed.proxyConfiguration = input.proxyConfiguration as ProxyConfigurationOptions;
    }

    return parsed;
}

/**
 * Picks the SERP provider when the user left it on "auto".
 *
 * Dorking needs a SERP path with real proxies: Google blocks datacentre IPs
 * within a handful of advanced-operator queries, so there is no useful
 * direct-fetch fallback, and "auto" without a token resolves to off rather
 * than to something that would fail halfway through a run.
 */
export function resolveSerpProvider(input: ActorInput, hasApifyToken: boolean): Exclude<SerpProviderName, 'auto'> {
    if (input.serpProvider !== 'auto') return input.serpProvider;
    return hasApifyToken ? 'apify-actor' : 'none';
}
