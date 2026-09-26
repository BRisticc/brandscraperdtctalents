import { Actor, log } from 'apify';
import { normaliseUrl } from '../util/domain.js';
import { collapseWhitespace, truncate } from '../util/text.js';
import type { DorkQuery } from './dorks.js';

/** One organic result, normalised across whatever SERP actor produced it. */
export interface SerpResult {
    url: string;
    title: string;
    snippet: string;
    /** 1-based rank on its SERP page. */
    position: number;
    /** The dork that found it. */
    queryId: string;
    query: string;
    engine: string;
}

export interface SerpSearchOptions {
    /** Organic results wanted per query. */
    resultsPerQuery: number;
    /** ISO-3166 alpha-2, lower-cased by the provider as each actor expects. */
    country?: string;
    language?: string;
}

export interface SerpProvider {
    readonly name: string;
    readonly warnings: string[];
    /**
     * Runs a batch of dorks.
     *
     * Batched, not one call per query: every SERP actor takes a multi-line
     * `queries` field, and one nested run for forty dorks is the difference
     * between a few compute units and a few hundred.
     */
    search(queries: DorkQuery[], opts: SerpSearchOptions): Promise<SerpResult[]>;
}

export class NoOpSerpProvider implements SerpProvider {
    readonly name = 'none';

    readonly warnings = ['Agency attribution was disabled (serpProvider: "none"); no dorks were run.'];

    async search(): Promise<SerpResult[]> {
        return [];
    }
}

/** Pulls the first array of result-shaped objects out of an unknown item. */
function organicArray(item: Record<string, unknown>): Record<string, unknown>[] {
    for (const key of ['organicResults', 'organic_results', 'results', 'organic', 'items']) {
        const value = item[key];
        if (Array.isArray(value)) return value as Record<string, unknown>[];
    }
    // Some actors flatten one result per dataset item.
    if (typeof item.url === 'string' || typeof item.link === 'string') return [item];
    return [];
}

function str(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

/** The search term a SERP item came back for, wherever the actor records it. */
export function itemQueryTerm(item: Record<string, unknown>): string {
    const sq = item.searchQuery;
    if (sq && typeof sq === 'object') {
        const term = (sq as Record<string, unknown>).term ?? (sq as Record<string, unknown>).query;
        if (typeof term === 'string') return term;
    }
    for (const key of ['query', 'keyword', 'term', 'searchTerm']) {
        const value = item[key];
        if (typeof value === 'string') return value;
    }
    return '';
}

/**
 * Turns one SERP dataset item into `SerpResult`s, attributing each back to the
 * dork that produced it. Actors that drop the query on the floor fall back to
 * `fallback`, so provenance is never simply lost.
 */
export function normaliseSerpItem(
    item: Record<string, unknown>,
    byQuery: Map<string, DorkQuery>,
    engine: string,
    fallback: DorkQuery | undefined,
): SerpResult[] {
    const term = itemQueryTerm(item);
    const dork = byQuery.get(term.trim().toLowerCase()) ?? fallback;
    const out: SerpResult[] = [];

    organicArray(item).forEach((raw, index) => {
        const rawUrl = str(raw.url) || str(raw.link) || str(raw.href);
        const url = normaliseUrl(rawUrl);
        if (!url) return;
        const positionValue = raw.position ?? raw.rank;
        out.push({
            url,
            title: truncate(collapseWhitespace(str(raw.title) || str(raw.name)), 300),
            snippet: truncate(
                collapseWhitespace(str(raw.description) || str(raw.snippet) || str(raw.text)),
                600,
            ),
            position: typeof positionValue === 'number' && positionValue > 0 ? positionValue : index + 1,
            queryId: dork?.id ?? 'unknown',
            query: term || dork?.query || '',
            engine,
        });
    });

    return out;
}

/**
 * Turns one nested run into the warning a human needs, or null when it went
 * fine.
 *
 * This exists because `Actor.call` resolves with the run whatever its terminal
 * status: a FAILED nested run still hands back an (empty) default dataset, so
 * without an explicit status check the caller reads zero items and reports
 * "Google found nothing" for what was actually an actor that never ran. That
 * is the difference between "narrow your dorks" and "rent the actor".
 */
export function describeRunOutcome(input: {
    actorId: string;
    batchNumber: number;
    batchSize: number;
    status?: string;
    runId?: string;
    hasDataset: boolean;
    itemCount: number;
    parsedCount: number;
}): string | null {
    const where = `batch ${input.batchNumber} (${input.batchSize} quer${input.batchSize === 1 ? 'y' : 'ies'})`;
    const run = input.runId
        ? ` Nested run ${input.runId}: https://console.apify.com/actors/runs/${input.runId}`
        : '';

    if (input.status && input.status !== 'SUCCEEDED') {
        return `SERP actor "${input.actorId}" ${where}: nested run ended ${input.status}, not SUCCEEDED. `
            + `Open it to see why — a rental actor you have not subscribed to, or one out of memory or time, `
            + `fails here and looks like "no results" downstream.${run}`;
    }
    if (!input.hasDataset) {
        return `SERP actor "${input.actorId}" ${where}: no dataset came back.${run}`;
    }
    if (input.itemCount === 0) {
        return `SERP actor "${input.actorId}" ${where}: the run succeeded but its dataset is empty. `
            + `Google returned nothing for these queries, or the actor was blocked.${run}`;
    }
    if (input.parsedCount === 0) {
        return `SERP actor "${input.actorId}" ${where}: ${input.itemCount} item(s) came back but none held organic `
            + `results in a shape this actor reads. Check that actor's output, or point serpApifyActorId `
            + `at a different one.${run}`;
    }
    return null;
}

export interface ApifySerpOptions {
    actorId: string;
    extraInput?: Record<string, unknown>;
    /** Dorks per nested run. Keeps one bad query from failing the whole batch. */
    batchSize?: number;
    memoryMbytes?: number;
    timeoutSecs?: number;
}

/**
 * Runs dorks through an existing Apify SERP actor
 * (apify/google-search-scraper by default).
 *
 * Going through a SERP actor rather than fetching google.com directly is not
 * a convenience: Google blocks datacentre traffic within a handful of queries,
 * and the advanced operators this actor depends on — AROUND(), before:/after:,
 * filetype: — are exactly the ones that trip the bot check soonest.
 */
export class ApifySerpProvider implements SerpProvider {
    readonly name = 'apify-actor';

    readonly warnings: string[] = [];

    private readonly opts: ApifySerpOptions;

    constructor(opts: ApifySerpOptions) {
        this.opts = opts;
    }

    async search(queries: DorkQuery[], opts: SerpSearchOptions): Promise<SerpResult[]> {
        const wanted = queries.filter((q) => q.query.trim());
        if (wanted.length === 0) return [];

        const byQuery = new Map(wanted.map((q) => [q.query.trim().toLowerCase(), q]));
        const batchSize = Math.max(1, this.opts.batchSize ?? 20);
        const results: SerpResult[] = [];

        for (let start = 0; start < wanted.length; start += batchSize) {
            const batch = wanted.slice(start, start + batchSize);
            // Only fields apify/google-search-scraper actually declares. An
            // undeclared property fails Apify's input validation outright, and
            // a nested run that never starts is the hardest failure to read
            // from the outside. Anything else goes through serpApifyActorInput.
            //
            // proxyConfiguration is deliberately NOT set: that actor runs on
            // Apify's GOOGLE_SERP proxy group by default, and overriding it
            // with residential or datacentre groups gets soft-blocked.
            const input: Record<string, unknown> = {
                queries: batch.map((q) => q.query).join('\n'),
                resultsPerPage: Math.min(100, Math.max(1, opts.resultsPerQuery)),
                maxPagesPerQuery: 1,
                countryCode: (opts.country ?? 'us').toLowerCase(),
                languageCode: (opts.language ?? 'en').toLowerCase(),
                mobileResults: false,
                ...(this.opts.extraInput ?? {}),
            };

            try {
                const callOptions: Parameters<typeof Actor.call>[2] = {};
                if (this.opts.memoryMbytes) callOptions.memory = this.opts.memoryMbytes;
                if (this.opts.timeoutSecs) callOptions.timeout = this.opts.timeoutSecs;

                const run = await Actor.call(this.opts.actorId, input, callOptions);
                const batchNumber = Math.floor(start / batchSize) + 1;
                if (run?.id) {
                    log.info(`  SERP batch ${batchNumber}: nested run ${run.id} → ${run.status ?? 'unknown status'}`);
                }

                let items: unknown[] = [];
                if (run?.defaultDatasetId && run.status === 'SUCCEEDED') {
                    ({ items } = await Actor.apifyClient
                        .dataset(run.defaultDatasetId)
                        .listItems({ limit: batch.length * Math.max(1, opts.resultsPerQuery) + batch.length }));
                }

                const before = results.length;
                for (const item of items) {
                    results.push(...normaliseSerpItem(item as Record<string, unknown>, byQuery, this.name, batch[0]));
                }

                const problem = describeRunOutcome({
                    actorId: this.opts.actorId,
                    batchNumber,
                    batchSize: batch.length,
                    ...(run?.status ? { status: run.status } : {}),
                    ...(run?.id ? { runId: run.id } : {}),
                    hasDataset: Boolean(run?.defaultDatasetId),
                    itemCount: items.length,
                    parsedCount: results.length - before,
                });
                if (problem) {
                    log.warning(problem);
                    this.warnings.push(problem);
                }
            } catch (err) {
                const message = (err as Error).message;
                log.warning(`SERP actor call failed: ${message}`);
                this.warnings.push(
                    `SERP actor "${this.opts.actorId}" could not be called for batch `
                    + `${Math.floor(start / batchSize) + 1}: ${message}`,
                );
            }
        }

        return results;
    }
}
