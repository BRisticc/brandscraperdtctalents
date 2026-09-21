import { Actor, log } from 'apify';
import { InputError, parseInput, resolveSerpProvider } from './input.js';
import { researchAgencies } from './attribution/attribution.js';
import { resolveBrandSites, type ResolvedBrand } from './attribution/resolve.js';
import { ApifySerpProvider, NoOpSerpProvider, type SerpProvider } from './attribution/serp.js';
import { buildBrandRow, buildRunReport } from './report/report-builder.js';
import { renderMarkdown } from './report/markdown.js';
import { renderHtml } from './report/html.js';
import { mapWithConcurrency, type FetchOptions } from './util/http.js';
import { proxySessionId } from './util/proxy.js';
import type { BrandAttributionRow } from './types.js';

await Actor.init();

try {
    const input = parseInput(await Actor.getInput<Record<string, unknown>>());
    const warnings: string[] = [];

    const proxyConfiguration = input.proxyConfiguration
        ? await Actor.createProxyConfiguration(input.proxyConfiguration)
        : undefined;

    const fetchOptions = async (sessionLabel: string): Promise<FetchOptions> => {
        const opts: FetchOptions = {
            timeoutSecs: input.requestTimeoutSecs,
            retries: input.maxRequestRetries,
        };
        const proxyUrl = await proxyConfiguration?.newUrl(proxySessionId(sessionLabel));
        if (proxyUrl) opts.proxyUrl = proxyUrl;
        return opts;
    };

    // ------------------------------------------------------- 1. search provider
    const hasToken = Boolean(process.env.APIFY_TOKEN || Actor.isAtHome());
    const providerName = resolveSerpProvider(input, hasToken);
    let serpProvider: SerpProvider;
    if (providerName === 'apify-actor') {
        serpProvider = new ApifySerpProvider({
            actorId: input.serpApifyActorId,
            ...(input.serpApifyActorInput ? { extraInput: input.serpApifyActorInput } : {}),
        });
    } else {
        serpProvider = new NoOpSerpProvider();
        warnings.push(
            'No SERP provider: this actor cannot run its dorks. Set serpProvider to "apify-actor" and run on '
            + 'the Apify platform (or export APIFY_TOKEN locally).',
        );
    }
    log.info(`Stage 1/3 — search provider "${serpProvider.name}" for ${input.brandNames.length} brand(s)`);

    // ---------------------------------------------------------- 2. name → domain
    // The domain is not the product here; it is what goes into `-site:` so the
    // brand's own marketing cannot answer for who runs its ads.
    let resolved: ResolvedBrand[] = input.brandNames.map((name) => ({ name, confidence: 0 }));
    if (input.resolveBrandSites && serpProvider.name !== 'none') {
        log.info('Stage 2/3 — resolving each brand name to its own domain (one plain query each)');
        resolved = await resolveBrandSites(input.brandNames, serpProvider, {
            country: input.serpCountry,
            language: input.serpLanguage,
        });
        for (const entry of resolved) {
            if (entry.domain) {
                log.info(`  "${entry.name}" → ${entry.domain} (${entry.confidence})`);
            } else {
                const why = entry.note ? `: ${entry.note.replace(/\.$/, '')}` : '';
                warnings.push(`Could not resolve "${entry.name}" to a domain${why}. `
                    + 'Its dorks will run without the -site: exclusion, so expect more of its own pages.');
            }
        }
    }

    // -------------------------------------------------------------- 3. attribute
    log.info('Stage 3/3 — dorking, opening every hit, following the documents they link');

    // Every brand fires a nested SERP run, so this lane stays narrow on
    // purpose: two brands in flight, not the whole list.
    const rows: BrandAttributionRow[] = await mapWithConcurrency(
        resolved,
        Math.min(2, input.maxConcurrency),
        async (entry, index) => {
            const attribution = await researchAgencies(
                {
                    brand: entry.name,
                    ...(entry.domain ? { domain: entry.domain } : {}),
                    extraAliases: input.extraBrandAliases,
                },
                {
                    provider: serpProvider,
                    tiers: input.dorkTiers,
                    extraSurfaces: input.extraDorkSurfaces,
                    excludeDomains: input.excludeDomains,
                    ...(input.dorkAfterDate ? { after: input.dorkAfterDate } : {}),
                    ...(input.dorkBeforeDate ? { before: input.dorkBeforeDate } : {}),
                    maxQueries: input.maxDorkQueries,
                    resultsPerQuery: input.resultsPerDork,
                    maxPagesToVerify: input.maxClaimPagesPerBrand,
                    maxHarvestedPages: input.maxHarvestedPages,
                    extraDocumentHosts: input.extraDocumentHosts,
                    minClaimScore: input.minClaimScore,
                    country: input.serpCountry,
                    language: input.serpLanguage,
                    concurrency: Math.min(6, input.maxConcurrency * 2),
                    fetchOptions: await fetchOptions(`dork_${index}`),
                },
            );

            warnings.push(...attribution.warnings);
            const top = attribution.claims[0];
            log.info(
                `  ${entry.name} → ${attribution.claims.length} operator(s)`
                + `${attribution.documentsHarvested > 0 ? `, ${attribution.documentsHarvested} linked doc(s)` : ''}`
                + `${top ? `; strongest: ${top.claimant.name} (${top.score})` : ''}`,
            );
            return buildBrandRow(attribution);
        },
    );

    warnings.push(...serpProvider.warnings);

    await Actor.pushData(rows);
    const runReport = buildRunReport(rows, { serpProvider: serpProvider.name, warnings });

    if (input.outputFormats.includes('json')) {
        await Actor.setValue('REPORT.json', runReport);
    }
    if (input.outputFormats.includes('markdown')) {
        await Actor.setValue('REPORT.md', renderMarkdown(runReport), { contentType: 'text/markdown; charset=utf-8' });
    }
    if (input.outputFormats.includes('html')) {
        await Actor.setValue('REPORT.html', renderHtml(runReport), { contentType: 'text/html; charset=utf-8' });
    }

    log.info(
        `Done. ${runReport.brandsResearched} brand(s), ${runReport.dorksRun} dorks, `
        + `${runReport.pagesRead} pages read, ${runReport.documentsHarvested} linked documents, `
        + `${runReport.operatorsFound} operator(s). Reports are in the key-value store.`,
    );
    for (const warning of warnings) log.warning(warning);

    await Actor.exit();
} catch (err) {
    if (err instanceof InputError) {
        log.error(`Invalid input: ${err.message}`);
        await Actor.fail(err.message);
    } else {
        throw err;
    }
}
