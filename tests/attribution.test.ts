import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
    anyOf, around, brandAliases, buildDorks, fitWords, surfaceByKey, type DorkQuery,
} from '../src/attribution/dorks.js';
import { readableUrl, isBinaryContentType } from '../src/attribution/readable.js';
import {
    dedupeHarvest, documentIdentity, harvestDocumentLinks, surfaceForDocumentUrl,
} from '../src/attribution/link-harvest.js';
import { claimantFromUrl, claimantsFromText, mergeClaimant } from '../src/attribution/claimants.js';
import {
    extractClaimPhrases, extractMetrics, quoteAround, scoreEvidence,
} from '../src/attribution/verify.js';
import { normaliseSerpItem, itemQueryTerm, type SerpResult } from '../src/attribution/serp.js';
import { resolutionQuery, scoreBrandSite } from '../src/attribution/resolve.js';
import { buildOperatorLeaderboard } from '../src/report/report-builder.js';
import { htmlToText, load } from '../src/util/html.js';
import { normalise } from '../src/util/text.js';
import type { BrandAttributionRow } from '../src/types.js';

const TARGET = {
    brand: 'My Patriot Supply',
    aliases: ['Ready Hour', 'mypatriotsupply'],
    domain: 'mypatriotsupply.com',
};

const ALL_TIERS = ['core', 'docs', 'social', 'directories', 'wide'] as const;

describe('dork operators', () => {
    it('quotes every term and only parenthesises a real group', () => {
        assert.equal(anyOf(['case study']), '"case study"');
        assert.equal(anyOf(['a', 'b']), '("a" OR "b")');
        assert.equal(anyOf([]), '');
    });

    it('dedupes terms inside an OR group', () => {
        assert.equal(anyOf(['roas', 'roas', 'cpa']), '("roas" OR "cpa")');
    });

    it('writes proximity the way Google parses it', () => {
        assert.equal(around('"a"', '"b"', 10), '"a" AROUND(10) "b"');
    });

    it('drops terms from the tail until the query fits the word budget', () => {
        const long = Array.from({ length: 40 }, (_, i) => `term-number-${i}`);
        const fitted = fitWords('"Brand"', long, 'site:example.com');
        assert.ok(fitted.split(/\s+/).length <= 30, `too long: ${fitted}`);
        // Strongest synonym survives, weakest is the first to go.
        assert.ok(fitted.includes('term-number-0'));
        assert.ok(!fitted.includes('term-number-39'));
    });

    it('never returns an empty group even when nothing fits', () => {
        const fitted = fitWords('"Brand"', ['only term'], 'site:x.com');
        assert.ok(fitted.includes('"only term"'));
    });
});

describe('brand aliases', () => {
    it('derives the slug and squashed forms people actually type', () => {
        const aliases = brandAliases('My Patriot Supply', 'mypatriotsupply.com');
        assert.ok(aliases.includes('My Patriot Supply'));
        assert.ok(aliases.includes('mypatriotsupply'));
        assert.ok(aliases.includes('my-patriot-supply'));
        assert.ok(aliases.includes('mypatriotsupply.com'));
    });

    it('keeps user-supplied aliases and drops duplicates', () => {
        const aliases = brandAliases('Nutrient Survival', undefined, ['Nutrient Survival', 'NS Foods']);
        assert.deepEqual(aliases.filter((a) => a === 'Nutrient Survival').length, 1);
        assert.ok(aliases.includes('NS Foods'));
    });

    it('does not invent a squashed alias for a one-word brand', () => {
        assert.deepEqual(brandAliases('Ridge'), ['Ridge']);
    });
});

describe('dork generation', () => {
    const dorks = buildDorks(TARGET, { tiers: [...ALL_TIERS], maxQueries: 250 });

    it('puts the brand in every query', () => {
        for (const dork of dorks) {
            assert.ok(dork.query.includes('My Patriot Supply'), `no brand in: ${dork.query}`);
        }
    });

    it('stays inside the word budget Google honours', () => {
        for (const dork of dorks) {
            assert.ok(dork.query.split(/\s+/).length <= 32, `too long (${dork.query.split(/\s+/).length}): ${dork.query}`);
        }
    });

    it('produces no duplicate queries', () => {
        const seen = new Set(dorks.map((d) => d.query.toLowerCase()));
        assert.equal(seen.size, dorks.length);
    });

    it('reaches the open-document surfaces the user cares about', () => {
        const queries = dorks.map((d) => d.query).join(' | ');
        for (const operator of [
            'site:docs.google.com', 'site:drive.google.com', 'site:drive.google.com inurl:folders',
            'site:canva.com', 'filetype:pdf', 'filetype:pptx',
        ]) {
            assert.ok(queries.includes(operator), `missing surface: ${operator}`);
        }
    });

    it('asks for the pages that link to open documents, not only for the documents', () => {
        // A Drive link is in the index only once something crawlable linked
        // it, so the pages doing the linking are their own target.
        const seed = buildDorks(TARGET, { tiers: ['core'], maxQueries: 100 })
            .find((d) => d.query.includes('docs.google.com') && d.query.includes('drive.google.com'));
        assert.ok(seed, 'no dork looks for pages that link to open documents');
        assert.ok(seed.query.includes('AROUND('), 'the link seed should demand proximity to the brand');
    });

    it('never emits a query for a link-only surface', () => {
        assert.ok(!dorks.some((d) => d.surface === 'linked-doc'));
    });

    it('excludes the brand\'s own site so its marketing cannot answer for it', () => {
        assert.ok(dorks.some((d) => d.query.includes('-site:mypatriotsupply.com')));
    });

    it('honours the tier filter', () => {
        const coreOnly = buildDorks(TARGET, { tiers: ['core'], maxQueries: 100 });
        assert.ok(coreOnly.length > 0);
        assert.deepEqual([...new Set(coreOnly.map((d) => d.tier))], ['core']);
        assert.ok(!coreOnly.some((d) => d.query.includes('site:docs.google.com')));
    });

    it('returns the surviving queries in weight order', () => {
        const weights = dorks.map((d) => d.weight);
        assert.deepEqual(weights, [...weights].sort((a, b) => b - a));
    });

    it('never lets one tier eat the whole cap', () => {
        // The docs surfaces carry the highest weights and outnumber every
        // other tier, so a straight weight sort would drop `core` entirely.
        const capped = buildDorks(TARGET, { tiers: [...ALL_TIERS], maxQueries: 10 });
        assert.equal(capped.length, 10);
        const tiers = new Set(capped.map((d) => d.tier));
        for (const tier of ALL_TIERS) assert.ok(tiers.has(tier), `tier "${tier}" was starved out of the cap`);
    });

    it('gives each tier its own strongest queries', () => {
        const capped = buildDorks(TARGET, { tiers: ['core', 'docs'], maxQueries: 6 });
        for (const tier of ['core', 'docs'] as const) {
            const inCap = capped.filter((d) => d.tier === tier).map((d) => d.weight);
            const available = dorks.filter((d) => d.tier === tier).map((d) => d.weight);
            assert.ok(inCap.length > 0);
            assert.equal(Math.max(...inCap), Math.max(...available), `${tier}: best query missing from the cap`);
        }
    });

    it('hands a small tier\'s turns back rather than returning short', () => {
        const capped = buildDorks(TARGET, { tiers: [...ALL_TIERS], maxQueries: 60 });
        assert.equal(capped.length, 60);
    });

    it('renumbers ids after the cap so they stay stable and unique', () => {
        const capped = buildDorks(TARGET, { tiers: [...ALL_TIERS], maxQueries: 8 });
        assert.deepEqual(capped.map((d) => d.id), ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8']);
    });

    it('applies the date window to every query when asked', () => {
        const windowed = buildDorks(TARGET, {
            tiers: ['core'], maxQueries: 20, after: '2024-01-01', before: '2025-06-30',
        });
        for (const dork of windowed) {
            assert.ok(dork.query.includes('after:2024-01-01'), dork.query);
            assert.ok(dork.query.includes('before:2025-06-30'), dork.query);
        }
    });

    it('accepts caller-supplied surfaces', () => {
        const extended = buildDorks(TARGET, {
            tiers: ['core'], maxQueries: 100, extraSurfaces: ['site:behance.net'],
        });
        assert.ok(extended.some((d) => d.query.includes('site:behance.net')));
    });

    it('uses proximity rather than plain AND for the results axis', () => {
        assert.ok(buildDorks(TARGET, { tiers: ['core'], maxQueries: 100 })
            .some((d) => d.intent === 'results' && /AROUND\(\d+\)/.test(d.query)));
    });

    it('returns nothing for an empty brand instead of dorking the whole web', () => {
        assert.deepEqual(buildDorks({ brand: '  ', aliases: [] }, { tiers: ['core'], maxQueries: 10 }), []);
    });

    it('names a real surface for every query it emits', () => {
        for (const dork of dorks) {
            if (dork.surface.startsWith('site:') || dork.surface.startsWith('filetype:')) continue;
            assert.ok(surfaceByKey(dork.surface), `unknown surface: ${dork.surface}`);
        }
    });
});

describe('readable URLs for the document surfaces', () => {
    it('rewrites a Google Doc to its text export', () => {
        const target = readableUrl('https://docs.google.com/document/d/1AbCdEfGhIjK/edit?usp=sharing');
        assert.equal(target.url, 'https://docs.google.com/document/d/1AbCdEfGhIjK/export?format=txt');
        assert.equal(target.format, 'text');
        assert.equal(target.rewritten, true);
    });

    it('rewrites Slides to htmlpresent, the only plain-HTML projection', () => {
        const target = readableUrl('https://docs.google.com/presentation/d/1AbCdEfGhIjK/edit#slide=id.p1');
        assert.equal(target.url, 'https://docs.google.com/presentation/d/1AbCdEfGhIjK/htmlpresent');
        assert.equal(target.format, 'html');
    });

    it('rewrites Sheets to a CSV export', () => {
        const target = readableUrl('https://docs.google.com/spreadsheets/d/1AbCdEfGhIjK/edit#gid=0');
        assert.equal(target.url, 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjK/export?format=csv');
        assert.equal(target.format, 'csv');
    });

    it('keeps the /e/ segment for a published document', () => {
        const target = readableUrl('https://docs.google.com/document/d/e/2PACX-1vABC/view');
        assert.ok(target.url.includes('/d/e/2PACX-1vABC/'));
    });

    it('leaves an already-static published page alone', () => {
        const url = 'https://docs.google.com/document/d/e/2PACX-1vABC/pub';
        assert.equal(readableUrl(url).url, url);
        assert.equal(readableUrl(url).rewritten, false);
    });

    it('notes that Drive and Canva give a title only', () => {
        assert.match(readableUrl('https://drive.google.com/file/d/1Abc/view').note ?? '', /title/i);
        assert.match(readableUrl('https://www.canva.com/design/DAF123/xyz/view').note ?? '', /title/i);
    });

    it('passes an ordinary page through untouched', () => {
        const url = 'https://agency.com/case-studies/patriot';
        assert.deepEqual(readableUrl(url), { url, format: 'html', rewritten: false });
    });

    it('survives a malformed URL', () => {
        assert.equal(readableUrl('not a url').url, 'not a url');
    });

    it('knows which content types carry no readable text', () => {
        assert.equal(isBinaryContentType('application/pdf'), true);
        assert.equal(isBinaryContentType('image/png'), true);
        assert.equal(isBinaryContentType('text/html; charset=utf-8'), false);
    });
});

describe('recognising a document link', () => {
    it('splits Google Docs by kind so a deck is not scored as a text doc', () => {
        assert.equal(surfaceForDocumentUrl('https://docs.google.com/document/d/1Abc/edit'), 'gdocs');
        assert.equal(surfaceForDocumentUrl('https://docs.google.com/presentation/d/1Abc/edit'), 'gslides');
        assert.equal(surfaceForDocumentUrl('https://docs.google.com/spreadsheets/d/1Abc/edit'), 'gsheets');
    });

    it('recognises Drive files and open folders', () => {
        assert.equal(surfaceForDocumentUrl('https://drive.google.com/file/d/1Abc/view'), 'gdrive');
        assert.equal(surfaceForDocumentUrl('https://drive.google.com/drive/folders/1Abc'), 'gdrive');
    });

    it('recognises the other document products', () => {
        assert.equal(surfaceForDocumentUrl('https://www.canva.com/design/DAF1/x/view'), 'canva');
        assert.equal(surfaceForDocumentUrl('https://hazel.notion.site/Media-plan-123'), 'notion');
        assert.equal(surfaceForDocumentUrl('https://www.dropbox.com/scl/fi/abc/deck.pdf'), 'dropbox');
    });

    it('skips what is not somebody\'s work product', () => {
        assert.equal(surfaceForDocumentUrl('https://docs.google.com/forms/d/e/1FAIpQL/viewform'), null);
        assert.equal(surfaceForDocumentUrl('https://docs.google.com/drawings/d/1Abc/edit'), null);
        assert.equal(surfaceForDocumentUrl('https://www.canva.com/templates/'), null);
        assert.equal(surfaceForDocumentUrl('https://example.com/report.pdf'), null);
        assert.equal(surfaceForDocumentUrl('mailto:hi@hazelmedia.co'), null);
        assert.equal(surfaceForDocumentUrl('not a url'), null);
    });

    it('follows a caller-named host under the generic surface', () => {
        assert.equal(surfaceForDocumentUrl('https://coda.io/d/Plan_abc'), null);
        assert.equal(surfaceForDocumentUrl('https://coda.io/d/Plan_abc', ['coda.io']), 'linked-doc');
        assert.equal(surfaceForDocumentUrl('https://wiki.acme.com/plan', ['acme.com']), 'linked-doc');
    });

    it('collapses two links to the same document into one fetch', () => {
        assert.equal(
            documentIdentity('https://docs.google.com/document/d/1AbcDefGhiJkl/edit?usp=sharing'),
            documentIdentity('https://docs.google.com/document/d/1AbcDefGhiJkl/view'),
        );
        assert.notEqual(
            documentIdentity('https://docs.google.com/document/d/1AbcDefGhiJkl/edit'),
            documentIdentity('https://docs.google.com/document/d/2DefGhiJklMno/edit'),
        );
    });

    it('sees through a Canva share token and a Drive folder path', () => {
        assert.equal(
            documentIdentity('https://www.canva.com/design/DAFabcdefgh/tok1/view'),
            documentIdentity('https://www.canva.com/design/DAFabcdefgh/tok2/edit'),
        );
        assert.equal(documentIdentity('https://drive.google.com/drive/folders/1FolderAbcDef'), 'folder:1FolderAbcDef');
    });

    it('dedupes a harvest by document identity, keeping the first seen', () => {
        const links = [
            { url: 'https://docs.google.com/document/d/1AbcDefGhiJkl/edit', surface: 'gdocs', sourceUrl: 'https://a.com' },
            { url: 'https://docs.google.com/document/d/1AbcDefGhiJkl/view', surface: 'gdocs', sourceUrl: 'https://b.com' },
            { url: 'https://docs.google.com/document/d/2DefGhiJklMno/edit', surface: 'gdocs', sourceUrl: 'https://a.com' },
        ];
        const deduped = dedupeHarvest(links);
        assert.equal(deduped.length, 2);
        assert.equal(deduped[0]?.sourceUrl, 'https://a.com');
    });

    it('reads document links off a page and resolves them against it', () => {
        const $ = load(`<body>
            <a href="/relative/nope">no</a>
            <a href="https://docs.google.com/document/d/1Abc/edit">plan</a>
            <a href="//drive.google.com/drive/folders/1Def">assets</a>
            <a href="https://twitter.com/x">social</a>
        </body>`);
        const found = harvestDocumentLinks($, 'https://hazelmedia.co/resources');
        assert.deepEqual(found.map((f) => f.surface).sort(), ['gdocs', 'gdrive']);
        assert.ok(found.every((f) => f.sourceUrl === 'https://hazelmedia.co/resources'));
    });

    it('stops at the budget it was given', () => {
        const links = Array.from({ length: 10 }, (_, i) => `<a href="https://docs.google.com/document/d/1Abc${i}/edit">d</a>`).join('');
        assert.equal(harvestDocumentLinks(load(`<body>${links}</body>`), 'https://a.com', { max: 3 }).length, 3);
        assert.equal(harvestDocumentLinks(load(`<body>${links}</body>`), 'https://a.com', { max: 0 }).length, 0);
    });
});

describe('claimants read off a URL', () => {
    it('reads a person from a LinkedIn profile', () => {
        const claimant = claimantFromUrl('https://www.linkedin.com/in/ana-kovac-123', 'Ana Kovac - Media Buyer at Hazel | LinkedIn');
        assert.equal(claimant?.kind, 'person');
        assert.equal(claimant?.name, 'Ana Kovac');
        assert.equal(claimant?.key, 'linkedin:ana-kovac-123');
    });

    it('reads a company from a LinkedIn company page', () => {
        assert.equal(claimantFromUrl('https://www.linkedin.com/company/hazel-media', 'Hazel Media | LinkedIn')?.kind, 'agency');
    });

    it('recovers the author from a LinkedIn post slug', () => {
        const claimant = claimantFromUrl(
            'https://www.linkedin.com/posts/ana-kovac_we-scaled-activity-123',
            'Ana Kovac on LinkedIn: we scaled',
        );
        assert.equal(claimant?.key, 'linkedin:ana-kovac');
    });

    it('reads a handle from X', () => {
        assert.equal(claimantFromUrl('https://x.com/anabuys/status/1', 'Ana on X: "4.2x ROAS"')?.key, 'x:anabuys');
    });

    it('ignores X routes that are not profiles', () => {
        assert.equal(claimantFromUrl('https://x.com/search?q=test', 'search'), null);
    });

    it('separates Upwork freelancers from Upwork agencies', () => {
        assert.equal(claimantFromUrl('https://www.upwork.com/freelancers/~01abc', 'Ana K. - Media Buyer')?.kind, 'person');
        assert.equal(claimantFromUrl('https://www.upwork.com/agencies/hazel/', 'Hazel Media')?.kind, 'agency');
    });

    it('reads an agency from a Clutch profile', () => {
        assert.equal(claimantFromUrl('https://clutch.co/profile/hazel-media', 'Hazel Media | Clutch.co')?.kind, 'agency');
    });

    it('treats an ordinary site as the agency itself', () => {
        const claimant = claimantFromUrl('https://hazelmedia.co/case-studies/patriot', 'Case study');
        assert.equal(claimant?.kind, 'agency');
        assert.equal(claimant?.domain, 'hazelmedia.co');
        assert.equal(claimant?.key, 'site:hazelmedia.co');
    });

    it('never names the brand itself as its own agency', () => {
        assert.equal(claimantFromUrl('https://mypatriotsupply.com/pages/about', 'About', ['mypatriotsupply.com']), null);
    });

    it('returns nothing for an anonymous document surface', () => {
        assert.equal(claimantFromUrl('https://docs.google.com/document/d/1Abc/edit', 'Q3 media plan'), null);
    });

    it('merges two readings without losing the better-evidenced fields', () => {
        const a = { key: 'site:hazelmedia.co', kind: 'agency' as const, name: 'Hazelmedia', confidence: 60 };
        const b = { key: 'site:hazelmedia.co', kind: 'agency' as const, name: 'Hazel Media', domain: 'hazelmedia.co', confidence: 82 };
        const merged = mergeClaimant(a, b);
        assert.equal(merged.name, 'Hazel Media');
        assert.equal(merged.domain, 'hazelmedia.co');
        assert.ok(merged.confidence > 82, 'corroboration should raise confidence');
    });
});

describe('claimants read out of a document', () => {
    it('takes the agency from a contact email on its own domain', () => {
        const found = claimantsFromText('Q3 media plan. Questions: hello@hazelmedia.co');
        assert.equal(found[0]?.domain, 'hazelmedia.co');
        assert.equal(found[0]?.kind, 'agency');
    });

    it('ignores a free email provider', () => {
        assert.deepEqual(claimantsFromText('Contact ana.kovac@gmail.com').filter((c) => c.domain === 'gmail.com'), []);
    });

    it('reads a "prepared by" line', () => {
        const found = claimantsFromText('Media plan\nPrepared by: Hazel Media Group\nFor internal use');
        assert.ok(found.some((c) => c.name === 'Hazel Media Group' && c.kind === 'agency'));
    });

    it('classifies a bare human name as a person', () => {
        const found = claimantsFromText('Prepared by Ana Kovac');
        assert.equal(found.find((c) => c.name === 'Ana Kovac')?.kind, 'person');
    });

    it('falls back to a bare domain only when nothing better is present', () => {
        const found = claimantsFromText('Deck footer: hazelmedia.co');
        assert.equal(found[0]?.domain, 'hazelmedia.co');
        assert.ok((found[0]?.confidence ?? 100) < 60, 'a bare domain is weak evidence');
    });

    it('never names the brand or a platform as the claimant', () => {
        const found = claimantsFromText(
            'Prepared for mypatriotsupply.com, shared via docs.google.com',
            ['mypatriotsupply.com'],
        );
        assert.deepEqual(found.filter((c) => c.domain === 'mypatriotsupply.com' || c.domain === 'docs.google.com'), []);
    });
});

describe('evidence extraction', () => {
    it('pulls the result claims a practitioner would brag about', () => {
        const metrics = extractMetrics(
            'We hit 4.2x ROAS at $180k/month in ad spend, a 37% increase in AOV, and scaled from $40k to $1.2M.',
        );
        assert.ok(metrics.some((m) => /4\.2\s*x\s*roas/i.test(m)));
        assert.ok(metrics.some((m) => /\$180k\s*\/\s*month/i.test(m.replace(/\s+/g, ' '))));
        assert.ok(metrics.some((m) => /37%\s*increase/i.test(m)));
        assert.ok(metrics.some((m) => /scaled from/i.test(m)));
    });

    it('finds nothing in copy that claims nothing', () => {
        assert.deepEqual(extractMetrics('We are a full-service creative partner.'), []);
    });

    it('reports which claim vocabulary fired', () => {
        const hits = extractClaimPhrases(normalise('Our clients include several brands. Ana is a media buyer.'));
        assert.ok(hits.some((h) => h.intent === 'client-roster'));
        assert.ok(hits.some((h) => h.intent === 'role' && h.term === 'media buyer'));
    });

    it('quotes the sentence the brand appears in, not the top of the page', () => {
        const text = `${'filler '.repeat(200)}we ran paid social for My Patriot Supply all year${' tail'.repeat(200)}`;
        const quote = quoteAround(text, ['My Patriot Supply']);
        assert.ok(quote.includes('My Patriot Supply'));
        assert.ok(quote.startsWith('…'), 'a mid-page quote should be marked as clipped');
        assert.ok(quote.length < 500);
    });

    it('returns no quote when the brand is absent', () => {
        assert.equal(quoteAround('nothing relevant here', ['My Patriot Supply']), '');
    });

    it('reads text out of HTML without script or style noise', () => {
        const text = htmlToText(load('<body><style>.a{color:red}</style><script>var x=1</script><p>Case study: Ready Hour</p></body>'));
        assert.equal(text, 'Case study: Ready Hour');
    });
});

describe('evidence scoring', () => {
    const base = {
        surfaceWeight: 80, verified: true, brandInBody: true,
        metrics: 0, roles: 0, claimPhrases: 0, intent: 'case-study' as const, position: 1,
    };

    it('caps a page we could not open below anything we read', () => {
        const unread = scoreEvidence({ ...base, verified: false, metrics: 5, roles: 5, claimPhrases: 10 });
        const read = scoreEvidence({ ...base });
        assert.ok(unread <= 34, `unverified should stay low, got ${unread}`);
        assert.ok(read > unread);
    });

    it('penalises a page that loaded but never names the brand', () => {
        assert.ok(scoreEvidence({ ...base, brandInBody: false }) < scoreEvidence(base));
    });

    it('rewards result claims and role words', () => {
        assert.ok(scoreEvidence({ ...base, metrics: 3 }) > scoreEvidence(base));
        assert.ok(scoreEvidence({ ...base, roles: 2 }) > scoreEvidence(base));
    });

    it('lets the surface set the ceiling', () => {
        assert.ok(scoreEvidence({ ...base, surfaceWeight: 92 }) > scoreEvidence({ ...base, surfaceWeight: 54 }));
    });

    it('decays gently with rank, because dorks are already narrow', () => {
        const first = scoreEvidence(base);
        const tenth = scoreEvidence({ ...base, position: 10 });
        assert.ok(tenth < first);
        assert.ok(first - tenth <= 8);
    });

    it('never leaves the 0-100 range', () => {
        const max = scoreEvidence({ ...base, surfaceWeight: 100, metrics: 99, roles: 99, claimPhrases: 99, intent: 'internal-doc' });
        const min = scoreEvidence({ ...base, surfaceWeight: 0, verified: true, brandInBody: false, position: 100 });
        assert.ok(max <= 100 && min >= 0);
    });
});

describe('SERP normalisation', () => {
    const dork: DorkQuery = {
        id: 'q1', tier: 'core', surface: 'web', intent: 'case-study',
        query: '"My Patriot Supply" "case study"', weight: 85,
    };
    const byQuery = new Map([[dork.query.toLowerCase(), dork]]);

    it('reads the Google-search-scraper shape', () => {
        const results = normaliseSerpItem({
            searchQuery: { term: '"My Patriot Supply" "case study"' },
            organicResults: [
                { title: 'Hazel Media case study', url: 'https://hazelmedia.co/work', description: '4.2x ROAS', position: 1 },
            ],
        }, byQuery, 'apify-actor', undefined);
        assert.equal(results.length, 1);
        assert.equal(results[0]?.queryId, 'q1');
        assert.equal(results[0]?.url, 'https://hazelmedia.co/work');
        assert.equal(results[0]?.snippet, '4.2x ROAS');
    });

    it('reads a flattened one-result-per-item shape', () => {
        const results = normaliseSerpItem(
            { query: '"My Patriot Supply" "case study"', link: 'https://hazelmedia.co/work', title: 'Work' },
            byQuery, 'apify-actor', undefined,
        );
        assert.equal(results[0]?.url, 'https://hazelmedia.co/work');
    });

    it('falls back to the batch dork when the actor drops the query', () => {
        const results = normaliseSerpItem(
            { organicResults: [{ url: 'https://hazelmedia.co/work' }] },
            byQuery, 'apify-actor', dork,
        );
        assert.equal(results[0]?.queryId, 'q1');
    });

    it('positions results by order when the actor gives no rank', () => {
        const results = normaliseSerpItem({
            organicResults: [{ url: 'https://a.com' }, { url: 'https://b.com' }],
        }, byQuery, 'apify-actor', dork);
        assert.deepEqual(results.map((r) => r.position), [1, 2]);
    });

    it('drops entries with no usable URL rather than emitting empty rows', () => {
        assert.deepEqual(normaliseSerpItem({ organicResults: [{ title: 'no link' }] }, byQuery, 'apify-actor', dork), []);
    });

    it('finds the search term wherever the actor recorded it', () => {
        assert.equal(itemQueryTerm({ searchQuery: { term: 'a' } }), 'a');
        assert.equal(itemQueryTerm({ keyword: 'b' }), 'b');
        assert.equal(itemQueryTerm({}), '');
    });
});

describe('brand name resolution', () => {
    const result = (url: string, title: string, position = 1): SerpResult => ({
        url, title, snippet: '', position, queryId: 'resolve-0', query: '', engine: 'test',
    });

    it('asks a plain question, not a dork', () => {
        assert.equal(resolutionQuery('My Patriot Supply', 0).query, '"My Patriot Supply" official site');
    });

    it('prefers the homepage whose domain is the brand name', () => {
        const own = scoreBrandSite(result('https://mypatriotsupply.com/', 'My Patriot Supply'), 'My Patriot Supply');
        const article = scoreBrandSite(result('https://blog.example.com/a/b/c', 'My Patriot Supply review', 4), 'My Patriot Supply');
        assert.ok(own > article);
        assert.ok(own >= 40, 'the real site must clear the acceptance bar');
    });

    it('refuses retailers, marketplaces and platforms', () => {
        assert.equal(scoreBrandSite(result('https://www.amazon.com/dp/B01', 'My Patriot Supply'), 'My Patriot Supply'), -1);
        assert.equal(scoreBrandSite(result('https://www.linkedin.com/company/mps', 'My Patriot Supply'), 'My Patriot Supply'), -1);
    });
});

describe('operator leaderboard', () => {
    const row = (brand: string, claimantKey: string, claimantName: string, score: number): BrandAttributionRow => ({
        brand,
        aliases: [brand],
        operatorCount: 1,
        dorksRun: 0,
        resultsSeen: 0,
        documentsHarvested: 0,
        pagesRead: 0,
        scrapedAt: '2026-01-01T00:00:00.000Z',
        attribution: {
            brand,
            aliases: [brand],
            queries: [],
            resultsSeen: 0,
            resultsVerified: 0,
            documentsHarvested: 0,
            unattributed: [],
            warnings: [],
            claims: [{
                claimant: { key: claimantKey, kind: 'agency', name: claimantName, confidence: 80 },
                score,
                surfaces: ['Open web'],
                metrics: [],
                roles: ['media buyer'],
                verified: true,
                evidence: [],
            }],
        },
    });

    it('ranks an operator claiming several brands above a louder single claim', () => {
        const rows = buildOperatorLeaderboard([
            row('Brand A', 'site:hazelmedia.co', 'Hazel Media', 70),
            row('Brand B', 'site:hazelmedia.co', 'Hazel Media', 65),
            row('Brand C', 'site:solo.co', 'Solo', 95),
        ]);
        assert.equal(rows[0]?.name, 'Hazel Media');
        assert.deepEqual(rows[0]?.brands, ['Brand A', 'Brand B']);
        assert.equal(rows[0]?.bestScore, 70);
        assert.equal(rows[0]?.evidenceCount, 0);
        assert.equal(rows[1]?.name, 'Solo');
    });

    it('keeps two readings of one agency apart when the evidence does not join them', () => {
        // Same display name, different keys: collapsing them would assert an
        // identity match nothing in the evidence supports.
        const rows = buildOperatorLeaderboard([
            row('Brand A', 'site:hazelmedia.co', 'Hazel Media', 70),
            row('Brand B', 'linkedin:hazel-media', 'Hazel Media', 72),
        ]);
        assert.equal(rows.length, 2);
    });

    it('is empty when nothing was attributed', () => {
        assert.deepEqual(buildOperatorLeaderboard([]), []);
    });
});
