import { strict as assert } from 'node:assert';
import { after, before, describe, it } from 'node:test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { verifyHit } from '../src/attribution/verify.js';
import { researchAgencies } from '../src/attribution/attribution.js';
import type { DorkQuery } from '../src/attribution/dorks.js';
import type { SerpProvider, SerpResult } from '../src/attribution/serp.js';

const CASE_STUDY = `<!doctype html><html><head><title>Hazel Media — My Patriot Supply case study</title></head>
<body><nav><a href="/">Home</a></nav>
<style>.x{color:red}</style><script>var tracking = 1;</script>
<h1>How we scaled My Patriot Supply</h1>
<p>Our clients include several preparedness brands. As the media buyer on the account we took
My Patriot Supply from $40k to $1.2M and held 4.2x ROAS at $180k/month in ad spend.</p>
<footer>hello@hazelmedia.co</footer></body></html>`;

const UNRELATED = `<!doctype html><html><head><title>Ten ways to store rice</title></head>
<body><p>Long-term food storage is a growing category. Buckets, mylar, oxygen absorbers.</p></body></html>`;

/**
 * The shape the second hop exists for: a public page that says little itself
 * but links the work product. Google indexes this page; it indexes the
 * documents it links either shallowly or not at all.
 */
const RESOURCE_PAGE = (origin: string) => `<!doctype html><html><head><title>Hazel Media — resources</title></head>
<body><p>Decks and templates we share with clients.</p>
<ul>
  <li><a href="https://docs.google.com/document/d/1PlanAbcDefGhi/edit?usp=sharing">Q3 media plan</a></li>
  <li><a href="https://docs.google.com/presentation/d/1DeckAbcDefGhi/edit#slide=id.p1">Creative teardown</a></li>
  <li><a href="https://drive.google.com/drive/folders/1FolderAbcDefGhi">Shared assets</a></li>
  <li><a href="https://docs.google.com/forms/d/e/1FAIpQL/viewform">Feedback form</a></li>
  <li><a href="${origin}/case-study">Our case study</a></li>
  <li><a href="https://twitter.com/hazelmedia">Twitter</a></li>
</ul></body></html>`;

let server: http.Server;
let origin: string;

before(async () => {
    server = http.createServer((req, res) => {
        const path = (req.url ?? '/').split('?')[0];
        if (path === '/case-study') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(CASE_STUDY); return; }
        if (path === '/unrelated') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(UNRELATED); return; }
        if (path === '/resources') {
            res.writeHead(200, { 'content-type': 'text/html' });
            res.end(RESOURCE_PAGE(`http://127.0.0.1:${(server.address() as AddressInfo).port}`));
            return;
        }
        if (path === '/linked-plan') {
            res.writeHead(200, { 'content-type': 'text/plain' });
            res.end('Q3 media plan — My Patriot Supply. Prepared by: Hazel Media. Target 4.2x ROAS at $180k/month.');
            return;
        }
        if (path === '/hub') {
            res.writeHead(200, { 'content-type': 'text/html' });
            const here = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
            res.end(`<html><body><p>Links</p><a href="${here}/linked-plan">plan</a></body></html>`);
            return;
        }
        if (path === '/plan.txt') {
            res.writeHead(200, { 'content-type': 'text/plain' });
            res.end('Q3 media plan for My Patriot Supply. Prepared by: Hazel Media\nTarget 4.2x ROAS.');
            return;
        }
        if (path === '/deck.pdf') { res.writeHead(200, { 'content-type': 'application/pdf' }); res.end('%PDF-1.4 binary'); return; }
        if (path === '/gone') { res.writeHead(404); res.end('not found'); return; }
        res.writeHead(404); res.end('not found');
    });
    await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve); });
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
    await new Promise<void>((resolve) => { server.close(() => resolve()); });
});

const DORK: DorkQuery = {
    id: 'q1', tier: 'core', surface: 'web', intent: 'case-study',
    query: '"My Patriot Supply" "case study"', weight: 85,
};

const ALIASES = ['My Patriot Supply', 'mypatriotsupply'];
const FETCH = { timeoutSecs: 10, retries: 0, aliases: ALIASES };
const FETCH_LOCAL_DOCS = { ...FETCH, extraDocumentHosts: ['127.0.0.1'] };

function serp(url: string, title = 'result', position = 1): SerpResult {
    return { url, title, snippet: 'snippet text', position, queryId: 'q1', query: DORK.query, engine: 'test' };
}

describe('verifying a real page over HTTP', () => {
    it('confirms the brand, quotes it, and reads the numbers claimed', async () => {
        const hit = await verifyHit(serp(`${origin}/case-study`, 'Hazel Media case study'), DORK, FETCH);
        assert.equal(hit.verified, true);
        assert.ok(hit.quote.includes('My Patriot Supply'), hit.quote);
        assert.ok(hit.metrics.some((m) => /4\.2\s*x\s*roas/i.test(m)), hit.metrics.join(' | '));
        assert.ok(hit.roles.includes('media buyer'));
        assert.ok(hit.claimPhrases.includes('clients include'));
        assert.ok(hit.score > 50, `expected a strong score, got ${hit.score}`);
    });

    it('does not let script or style text reach the quote', async () => {
        const hit = await verifyHit(serp(`${origin}/case-study`), DORK, FETCH);
        assert.ok(!hit.quote.includes('var tracking'));
    });

    it('scores a page that loaded but never names the brand well below one that does', async () => {
        const named = await verifyHit(serp(`${origin}/case-study`), DORK, FETCH);
        const unrelated = await verifyHit(serp(`${origin}/unrelated`), DORK, FETCH);
        assert.equal(unrelated.verified, true);
        assert.ok(unrelated.score < named.score);
        assert.deepEqual(unrelated.metrics, []);
    });

    it('reads a plain-text export the way a document surface would serve it', async () => {
        const hit = await verifyHit(serp(`${origin}/plan.txt`), DORK, FETCH);
        assert.equal(hit.verified, true);
        assert.ok(hit.quote.includes('My Patriot Supply'));
        assert.ok(hit.metrics.some((m) => /4\.2/.test(m)));
    });

    it('says so plainly when the page is not text', async () => {
        const hit = await verifyHit(serp(`${origin}/deck.pdf`), DORK, FETCH);
        assert.equal(hit.verified, false);
        assert.match(hit.note ?? '', /Not readable/);
        assert.ok(hit.score <= 34, `an unread page must stay capped, got ${hit.score}`);
    });

    it('records an HTTP failure as evidence rather than throwing it away', async () => {
        const hit = await verifyHit(serp(`${origin}/gone`), DORK, FETCH);
        assert.equal(hit.verified, false);
        assert.match(hit.note ?? '', /HTTP 404/);
        assert.equal(hit.quote, 'snippet text', 'it should fall back to the snippet');
    });

    it('never throws on a host that does not exist', async () => {
        const hit = await verifyHit(serp('http://127.0.0.1:1/nothing'), DORK, { ...FETCH, timeoutSecs: 2 });
        assert.equal(hit.verified, false);
        assert.ok(hit.note);
    });
});

class StubSerpProvider implements SerpProvider {
    readonly name = 'stub';

    readonly warnings: string[] = [];

    /** Every dork this provider was asked to run, for assertions. */
    readonly seen: DorkQuery[] = [];

    constructor(private readonly urls: string[]) {}

    async search(queries: DorkQuery[]): Promise<SerpResult[]> {
        this.seen.push(...queries);
        const first = queries[0];
        if (!first) return [];
        return this.urls.map((url, index) => ({
            url,
            title: 'Hazel Media case study',
            snippet: 'we scaled My Patriot Supply',
            position: index + 1,
            queryId: first.id,
            query: first.query,
            engine: 'stub',
        }));
    }
}

describe('harvesting document links off a page', () => {
    it('finds the Google Docs, Slides and Drive links and skips the rest', async () => {
        const hit = await verifyHit(serp(`${origin}/resources`, 'Hazel Media resources'), DORK, FETCH);
        const links = hit.documentLinks ?? [];
        assert.ok(links.some((u) => u.includes('/document/d/1PlanAbcDefGhi')));
        assert.ok(links.some((u) => u.includes('/presentation/d/1DeckAbcDefGhi')));
        assert.ok(links.some((u) => u.includes('/drive/folders/1FolderAbcDefGhi')));
        // A form is not work product, and neither is a social profile.
        assert.ok(!links.some((u) => u.includes('viewform')));
        assert.ok(!links.some((u) => u.includes('twitter.com')));
    });

    it('collects nothing from a page with no documents on it', async () => {
        const hit = await verifyHit(serp(`${origin}/unrelated`), DORK, FETCH);
        assert.equal(hit.documentLinks, undefined);
    });

    it('ignores a host the caller did not name', async () => {
        const hit = await verifyHit(serp(`${origin}/hub`), DORK, FETCH);
        assert.equal(hit.documentLinks, undefined);
    });

    it('follows a caller-named host', async () => {
        const hit = await verifyHit(serp(`${origin}/hub`), DORK, FETCH_LOCAL_DOCS);
        assert.ok((hit.documentLinks ?? []).some((u) => u.endsWith('/linked-plan')));
    });

    it('honours a zero budget so the hop can be turned off', async () => {
        const hit = await verifyHit(serp(`${origin}/resources`), DORK, { ...FETCH, maxDocumentLinks: 0 });
        assert.equal(hit.documentLinks, undefined);
    });
});

describe('attribution end to end', () => {
    const options = (provider: SerpProvider) => ({
        provider,
        tiers: ['core' as const],
        maxQueries: 6,
        resultsPerQuery: 5,
        maxPagesToVerify: 10,
        maxHarvestedPages: 0,
        extraDocumentHosts: ['127.0.0.1'],
        minClaimScore: 30,
        concurrency: 3,
        fetchOptions: { timeoutSecs: 10, retries: 0 },
    });

    it('names the agency, keeps the evidence, and drops the page text', async () => {
        const provider = new StubSerpProvider([`${origin}/case-study`]);
        const result = await researchAgencies(
            { brand: 'My Patriot Supply', domain: 'mypatriotsupply.com' },
            options(provider),
        );

        assert.ok(result.queries.length > 0);
        assert.ok(provider.seen.length > 0, 'the provider should have been asked to run the dorks');
        assert.equal(result.resultsVerified, 1);

        const claim = result.claims[0];
        assert.ok(claim, 'expected at least one operator');
        assert.equal(claim.verified, true);
        assert.ok(claim.metrics.some((m) => /4\.2/.test(m)));
        assert.ok(claim.roles.includes('media buyer'));

        const evidence = claim.evidence[0];
        assert.ok(evidence);
        assert.ok(evidence.quote.includes('My Patriot Supply'));
        assert.equal('text' in evidence, false, 'page text must not reach the dataset');
    });

    it('follows a linked document and scores it as its own surface', async () => {
        const provider = new StubSerpProvider([`${origin}/hub`]);
        const result = await researchAgencies(
            { brand: 'My Patriot Supply' },
            { ...options(provider), maxHarvestedPages: 5, minClaimScore: 0 },
        );

        assert.equal(result.documentsHarvested, 1, 'the linked plan should have been followed');
        const evidence = result.claims.flatMap((c) => c.evidence);
        const hopped = evidence.find((e) => e.linkedFrom);
        assert.ok(hopped, 'expected evidence reached by following a link');
        assert.equal(hopped.linkedFrom, `${origin}/hub`);
        assert.ok(hopped.url.endsWith('/linked-plan'));
        assert.equal(hopped.verified, true);
        assert.ok(hopped.quote.includes('My Patriot Supply'));
        assert.ok(hopped.metrics.some((m) => /4\.2/.test(m)));
    });

    it('does not follow anything when the hop budget is zero', async () => {
        const provider = new StubSerpProvider([`${origin}/hub`]);
        const result = await researchAgencies(
            { brand: 'My Patriot Supply' },
            { ...options(provider), maxHarvestedPages: 0, minClaimScore: 0 },
        );
        assert.equal(result.documentsHarvested, 0);
        assert.deepEqual(result.claims.flatMap((c) => c.evidence).filter((e) => e.linkedFrom), []);
    });

    it('does not follow a document a dork already returned', async () => {
        const provider = new StubSerpProvider([`${origin}/hub`, `${origin}/linked-plan`]);
        const result = await researchAgencies(
            { brand: 'My Patriot Supply' },
            { ...options(provider), maxHarvestedPages: 5, minClaimScore: 0 },
        );
        assert.equal(result.documentsHarvested, 0, 'the plan was already opened by a dork');
    });

    it('keeps the harvested link list out of the dataset', async () => {
        const provider = new StubSerpProvider([`${origin}/resources`]);
        const result = await researchAgencies(
            { brand: 'My Patriot Supply' },
            { ...options(provider), maxHarvestedPages: 3, minClaimScore: 0 },
        );
        for (const evidence of result.claims.flatMap((c) => c.evidence)) {
            assert.equal('documentLinks' in evidence, false, 'working state must not reach the dataset');
            assert.equal('text' in evidence, false);
        }
    });

    it('dedupes a URL that several dorks return', async () => {
        const provider = new StubSerpProvider([`${origin}/case-study`, `${origin}/case-study`]);
        const result = await researchAgencies({ brand: 'My Patriot Supply' }, options(provider));
        const urls = result.claims.flatMap((c) => c.evidence.map((e) => e.url));
        assert.equal(new Set(urls).size, urls.length);
    });

    it('reports a brand nobody claims instead of inventing one', async () => {
        const provider = new StubSerpProvider([`${origin}/unrelated`]);
        const result = await researchAgencies(
            { brand: 'My Patriot Supply' },
            { ...options(provider), minClaimScore: 90 },
        );
        assert.deepEqual(result.claims, []);
        assert.ok(result.warnings.some((w) => /minClaimScore/.test(w)));
    });

    it('warns rather than failing when the search returns nothing', async () => {
        const result = await researchAgencies({ brand: 'My Patriot Supply' }, options(new StubSerpProvider([])));
        assert.deepEqual(result.claims, []);
        assert.equal(result.resultsSeen, 0);
        assert.ok(result.warnings.some((w) => /No search results/.test(w)));
        // Nothing went wrong in the provider, so the advice is about the dorks.
        assert.ok(result.warnings.some((w) => /queries themselves matched nothing/.test(w)));
    });

    it('carries the provider\'s own reason into the brand row', async () => {
        // A dataset row that says "no results" without saying why sends the
        // reader to the run report; the reason belongs on the row.
        class BrokenProvider extends StubSerpProvider {
            override async search(queries: DorkQuery[]): Promise<SerpResult[]> {
                await super.search(queries);
                this.warnings.push('SERP actor "x/y" batch 1: nested run ended FAILED, not SUCCEEDED.');
                return [];
            }
        }
        const result = await researchAgencies({ brand: 'My Patriot Supply' }, options(new BrokenProvider([])));
        assert.ok(
            result.warnings.some((w) => /ended FAILED/.test(w)),
            `provider reason missing from the row: ${result.warnings.join(' | ')}`,
        );
        assert.ok(result.warnings.some((w) => /See the search-provider warning above/.test(w)));
        assert.ok(!result.warnings.some((w) => /queries themselves matched nothing/.test(w)));
    });

    it('never dorks the whole web for an empty brand name', async () => {
        const provider = new StubSerpProvider([`${origin}/case-study`]);
        const result = await researchAgencies({ brand: '   ' }, options(provider));
        assert.deepEqual(result.queries, []);
        assert.equal(provider.seen.length, 0);
        assert.ok(result.warnings.some((w) => /too short or empty/.test(w)));
    });
});
