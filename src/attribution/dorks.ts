/**
 * The dork grammar.
 *
 * Attribution — "who actually runs this brand's ads" — is a search problem
 * before it is a scraping problem. A naive `"Brand" "case study"` returns the
 * brand's own site and press. What works is multiplying four orthogonal axes
 * and letting the engine do the joining:
 *
 *   entity   — the brand, its aliases, its bare domain
 *   surface  — WHERE practitioners publish (site:/filetype:)
 *   claim    — the LANGUAGE of claiming credit ("we scaled", "clients include")
 *   role     — WHO claims it (media buyer, creative strategist, growth partner)
 *
 * The full product of those axes is tens of thousands of queries, which is
 * both unaffordable and mostly noise, so queries are generated in weighted
 * tiers and the caller takes the top N. Tier `core` alone finds most agencies;
 * `docs` is the one that reaches open Drive/Docs/Canva decks.
 */

import { uniq } from '../util/text.js';
import { DOCUMENT_HOST_TERMS } from './link-harvest.js';

export type DorkTier = 'core' | 'docs' | 'social' | 'directories' | 'wide';

export const DORK_TIERS: readonly DorkTier[] = ['core', 'docs', 'social', 'directories', 'wide'];

/** What a query is trying to catch. Carried through to the evidence scoring. */
export type DorkIntent =
    | 'case-study'
    | 'client-roster'
    | 'results'
    | 'role'
    | 'portfolio'
    | 'hiring'
    | 'internal-doc'
    | 'contract';

export interface Surface {
    key: string;
    label: string;
    /** Operator fragment spliced into the query, e.g. `site:docs.google.com`. */
    operator: string;
    tier: DorkTier;
    /** 0-100: how much a hit here is worth as attribution evidence. */
    weight: number;
    /** True when the page needs a URL rewrite before its text can be read. */
    needsRewrite?: boolean;
    /** Reached only by following a link; never turned into a query. */
    linkOnly?: boolean;
}

/**
 * Where people who run ads for a living leave their fingerprints.
 *
 * Weight is "how strongly does a hit here mean this person ran the account",
 * not "how likely is a hit". An open media plan in someone's Drive is near
 * proof; a Reddit thread naming the brand is a lead.
 */
export const SURFACES: readonly Surface[] = [
    // --- core: the open web, no surface constraint -----------------------
    { key: 'web', label: 'Open web', operator: '', tier: 'core', weight: 60 },

    // --- docs: decks, briefs and reports that were never meant to rank ----
    { key: 'gdocs', label: 'Google Docs', operator: 'site:docs.google.com', tier: 'docs', weight: 92, needsRewrite: true },
    { key: 'gdrive', label: 'Google Drive', operator: 'site:drive.google.com', tier: 'docs', weight: 90, needsRewrite: true },
    // An open folder is a whole working directory, not one file — the single
    // strongest thing this actor can find, and the rarest.
    { key: 'gdrive-folders', label: 'Open Drive folders', operator: 'site:drive.google.com inurl:folders', tier: 'docs', weight: 94, needsRewrite: true },
    // Published-to-web docs are the one Drive surface Google is meant to index.
    { key: 'gdocs-published', label: 'Published Google Docs', operator: 'site:docs.google.com inurl:/d/e/', tier: 'docs', weight: 86, needsRewrite: true },
    { key: 'gslides', label: 'Google Slides', operator: 'site:docs.google.com inurl:presentation', tier: 'docs', weight: 90, needsRewrite: true },
    { key: 'gsheets', label: 'Google Sheets', operator: 'site:docs.google.com inurl:spreadsheets', tier: 'docs', weight: 88, needsRewrite: true },
    { key: 'canva', label: 'Canva', operator: 'site:canva.com inurl:design', tier: 'docs', weight: 82, needsRewrite: true },
    { key: 'notion', label: 'Notion', operator: 'site:notion.site', tier: 'docs', weight: 78 },
    { key: 'notion-so', label: 'Notion (notion.so)', operator: 'site:notion.so', tier: 'docs', weight: 72 },
    { key: 'pdf', label: 'PDF decks', operator: 'filetype:pdf', tier: 'docs', weight: 74 },
    { key: 'pptx', label: 'PowerPoint decks', operator: 'filetype:pptx', tier: 'docs', weight: 84 },
    { key: 'docx', label: 'Word documents', operator: 'filetype:docx', tier: 'docs', weight: 80 },
    { key: 'xlsx', label: 'Spreadsheets', operator: 'filetype:xlsx', tier: 'docs', weight: 76 },
    { key: 'slideshare', label: 'SlideShare', operator: 'site:slideshare.net', tier: 'docs', weight: 66 },
    { key: 'pitch', label: 'Pitch', operator: 'site:pitch.com', tier: 'docs', weight: 70 },
    { key: 'airtable', label: 'Airtable', operator: 'site:airtable.com', tier: 'docs', weight: 68 },
    { key: 'dropbox', label: 'Dropbox', operator: 'site:dropbox.com', tier: 'docs', weight: 72 },
    { key: 'figma', label: 'Figma', operator: 'site:figma.com', tier: 'docs', weight: 62 },
    { key: 'miro', label: 'Miro', operator: 'site:miro.com', tier: 'docs', weight: 60 },
    // Not a query: the surface a document gets when it was reached by
    // following a link off a page the dorks found, from a host the caller
    // named rather than one of the products above.
    { key: 'linked-doc', label: 'Linked document', operator: '', tier: 'docs', weight: 74, linkOnly: true },

    // --- social: where the claim is made in public ------------------------
    { key: 'li-profile', label: 'LinkedIn profiles', operator: 'site:linkedin.com/in', tier: 'social', weight: 88 },
    { key: 'li-post', label: 'LinkedIn posts', operator: 'site:linkedin.com/posts', tier: 'social', weight: 82 },
    { key: 'li-company', label: 'LinkedIn companies', operator: 'site:linkedin.com/company', tier: 'social', weight: 74 },
    { key: 'li-pulse', label: 'LinkedIn articles', operator: 'site:linkedin.com/pulse', tier: 'social', weight: 70 },
    { key: 'x', label: 'X / Twitter', operator: '(site:x.com OR site:twitter.com)', tier: 'social', weight: 68 },
    { key: 'youtube', label: 'YouTube', operator: 'site:youtube.com', tier: 'social', weight: 64 },
    { key: 'medium', label: 'Medium', operator: 'site:medium.com', tier: 'social', weight: 60 },
    { key: 'substack', label: 'Substack', operator: 'site:substack.com', tier: 'social', weight: 60 },
    { key: 'reddit', label: 'Reddit', operator: 'site:reddit.com', tier: 'social', weight: 54 },
    { key: 'threads', label: 'Threads', operator: 'site:threads.net', tier: 'social', weight: 50 },

    // --- directories: where agencies are listed with their roster ---------
    { key: 'clutch', label: 'Clutch', operator: 'site:clutch.co', tier: 'directories', weight: 78 },
    { key: 'upwork', label: 'Upwork', operator: 'site:upwork.com', tier: 'directories', weight: 76 },
    { key: 'contra', label: 'Contra', operator: 'site:contra.com', tier: 'directories', weight: 70 },
    { key: 'designrush', label: 'DesignRush', operator: 'site:designrush.com', tier: 'directories', weight: 64 },
    { key: 'goodfirms', label: 'GoodFirms', operator: 'site:goodfirms.co', tier: 'directories', weight: 62 },
    { key: 'sortlist', label: 'Sortlist', operator: 'site:sortlist.com', tier: 'directories', weight: 60 },
    { key: 'wellfound', label: 'Wellfound', operator: 'site:wellfound.com', tier: 'directories', weight: 58 },
    { key: 'podcasts', label: 'Podcast episodes', operator: '(site:podcasts.apple.com OR site:listennotes.com)', tier: 'directories', weight: 56 },
];

const SURFACE_BY_KEY = new Map(SURFACES.map((s) => [s.key, s]));

export function surfaceByKey(key: string): Surface | undefined {
    return SURFACE_BY_KEY.get(key);
}

/**
 * Vocabulary axes.
 *
 * These are the phrases practitioners actually type, not the phrases a brand
 * uses about itself. That asymmetry is what keeps the brand's own pages out
 * of the results without needing a `-site:` for every property they own.
 */
export const CLAIM_TERMS: Record<DorkIntent, string[]> = {
    'case-study': [
        'case study', 'client case study', 'how we scaled', 'how we took', 'results we got',
        'before and after', 'the results', 'what we did',
    ],
    'client-roster': [
        'our clients', 'clients include', 'trusted by', 'brands we work with', "brands we've worked with",
        'past clients', 'client roster', 'worked with', 'client list', 'partnered with',
    ],
    results: [
        'roas', 'return on ad spend', 'cpa', 'cost per acquisition', 'mer', 'aov',
        'ad spend', 'scaled to', 'per month in ad spend', 'revenue', 'blended roas', '7 figures', '8 figures',
    ],
    role: [
        'media buyer', 'creative strategist', 'performance marketer', 'growth partner',
        'paid social', 'paid media', 'growth marketer', 'ad buyer', 'facebook ads', 'meta ads',
        'ugc creator', 'direct response',
    ],
    portfolio: [
        'portfolio', 'my work', 'brands i have worked with', 'brands i work with', 'worked on',
        'resume', 'cv', 'about me',
    ],
    hiring: [
        'we are hiring', 'job description', 'now hiring', 'contract role', 'retainer',
        'looking for a media buyer', 'freelance',
    ],
    'internal-doc': [
        'creative brief', 'media plan', 'ad account audit', 'performance report', 'monthly report',
        'hook bank', 'swipe file', 'scaling plan', 'testing plan', 'creative matrix',
        'weekly report', 'account structure', 'launch plan',
    ],
    contract: [
        'statement of work', 'scope of work', 'proposal', 'invoice', 'retainer agreement',
        'prepared for', 'prepared by', 'submitted to',
    ],
};

export interface DorkQuery {
    /** Stable id so a result can be traced back to the query that found it. */
    id: string;
    tier: DorkTier;
    surface: string;
    intent: DorkIntent;
    query: string;
    /** 0-100, from the surface and the intent. Drives which queries survive the cap. */
    weight: number;
}

export interface DorkTarget {
    /** The brand as people write it, e.g. "My Patriot Supply". */
    brand: string;
    /** House brands, product lines, legal names, handles — anything else to match. */
    aliases: string[];
    /** The brand's own registrable domain, used both as a term and an exclusion. */
    domain?: string;
}

export interface DorkOptions {
    tiers: DorkTier[];
    /** Extra `site:`/`filetype:` fragments appended to the built-in catalogue. */
    extraSurfaces?: string[];
    /** Domains to `-site:` out of every query (the brand's own, plus retailers). */
    excludeDomains?: string[];
    /** ISO date. Becomes `after:`, which is how you ask "who runs it NOW". */
    after?: string;
    before?: string;
    maxQueries: number;
}

/** Google stops honouring terms past roughly this many words. */
const MAX_QUERY_WORDS = 30;

/**
 * Everything is phrase-quoted, single words included: an unquoted word lets
 * Google stem and synonym-expand it, which is exactly what you do not want
 * when the term is a brand name or a metric abbreviation.
 */
function quote(term: string): string {
    return `"${term.replace(/["]/g, '').trim()}"`;
}

/** `("a" OR "b")` — a single-member group drops the parentheses. */
export function anyOf(terms: string[]): string {
    const quoted = uniq(terms.map((t) => t.trim()).filter(Boolean)).map(quote);
    if (quoted.length === 0) return '';
    if (quoted.length === 1) return quoted[0] as string;
    return `(${quoted.join(' OR ')})`;
}

/**
 * Proximity. `"brand" AROUND(10) "roas"` is the single highest-signal operator
 * here: it demands the brand and the claim be in the same breath, which is the
 * difference between an agency's case study and a page that mentions both
 * somewhere in 4000 words.
 */
export function around(left: string, right: string, distance: number): string {
    return `${left} AROUND(${distance}) ${right}`;
}

function wordBudget(query: string): number {
    return query.split(/\s+/).filter(Boolean).length;
}

/**
 * Shrinks an OR-group until the whole query fits Google's word budget.
 * Terms are dropped from the tail, so callers should list their strongest
 * synonyms first.
 */
export function fitWords(prefix: string, terms: string[], suffix: string): string {
    let kept = terms.slice();
    while (kept.length > 1) {
        const candidate = [prefix, anyOf(kept), suffix].filter(Boolean).join(' ');
        if (wordBudget(candidate) <= MAX_QUERY_WORDS) return candidate;
        kept = kept.slice(0, -1);
    }
    return [prefix, anyOf(kept), suffix].filter(Boolean).join(' ');
}

function exclusions(target: DorkTarget, opts: DorkOptions): string {
    const domains = uniq([
        ...(target.domain ? [target.domain] : []),
        ...(opts.excludeDomains ?? []),
    ].map((d) => d.trim().toLowerCase().replace(/^www\./, '')).filter(Boolean));
    // Every -site: costs words, so only the brand's own properties are worth it.
    return domains.slice(0, 4).map((d) => `-site:${d}`).join(' ');
}

function dateWindow(opts: DorkOptions): string {
    return [
        opts.after ? `after:${opts.after}` : '',
        opts.before ? `before:${opts.before}` : '',
    ].filter(Boolean).join(' ');
}

/**
 * Derives the entity axis from a brand name.
 *
 * "My Patriot Supply" also answers to "mypatriotsupply" (handles, slugs,
 * folder names) and to its bare domain, which is how it appears in a UTM
 * string pasted into someone's report.
 */
export function brandAliases(brand: string, domain?: string, extra: string[] = []): string[] {
    const name = brand.trim();
    const squashed = name.replace(/[^A-Za-z0-9]+/g, '').toLowerCase();
    const hyphenated = name.replace(/\s+/g, '-').toLowerCase();
    const out = [name, ...extra.map((e) => e.trim()).filter(Boolean)];
    if (squashed.length >= 5 && squashed !== name.toLowerCase()) out.push(squashed);
    if (hyphenated !== name.toLowerCase() && hyphenated.length >= 5) out.push(hyphenated);
    if (domain) out.push(domain.replace(/^www\./, ''));
    return uniq(out.filter(Boolean));
}

interface Recipe {
    tier: DorkTier;
    surfaceKeys: string[];
    intent: DorkIntent;
    /** Terms for the claim axis, strongest first — they get trimmed from the tail. */
    terms: string[];
    /** Extra operator glued on, e.g. `inurl:case-study`. */
    operator?: string;
    /** Use AROUND() instead of plain AND. Costs a word, buys a lot of precision. */
    proximity?: number;
    /** Added to the surface weight. */
    bonus?: number;
}

/**
 * The recipe book. Each entry becomes one query per surface it names.
 *
 * Read this top to bottom and you have the whole method: what to look for,
 * where, and in what words.
 */
const RECIPES: Recipe[] = [
    // ---- core: works before you know anything about who runs the account --
    { tier: 'core', surfaceKeys: ['web'], intent: 'case-study', terms: CLAIM_TERMS['case-study'], bonus: 25 },
    { tier: 'core', surfaceKeys: ['web'], intent: 'client-roster', terms: CLAIM_TERMS['client-roster'], bonus: 22 },
    { tier: 'core', surfaceKeys: ['web'], intent: 'results', terms: CLAIM_TERMS.results, proximity: 12, bonus: 20 },
    { tier: 'core', surfaceKeys: ['web'], intent: 'role', terms: CLAIM_TERMS.role, proximity: 15, bonus: 18 },
    { tier: 'core', surfaceKeys: ['web'], intent: 'case-study', terms: ['case study', 'client'], operator: 'inurl:case-stud', bonus: 16 },
    { tier: 'core', surfaceKeys: ['web'], intent: 'client-roster', terms: ['client', 'brand'], operator: 'inurl:clients', bonus: 14 },
    { tier: 'core', surfaceKeys: ['web'], intent: 'portfolio', terms: CLAIM_TERMS.portfolio, operator: 'inurl:portfolio', bonus: 12 },
    { tier: 'core', surfaceKeys: ['web'], intent: 'case-study', terms: ['case study'], operator: 'intitle:"case study"', bonus: 15 },
    { tier: 'core', surfaceKeys: ['web'], intent: 'hiring', terms: CLAIM_TERMS.hiring, bonus: 6 },
    // The seed for the second hop. A Drive link is only in Google's index once
    // some crawlable page linked it, so the reliable way to reach open
    // documents is to find the pages doing the linking and read the links off
    // them — see attribution/link-harvest.ts.
    { tier: 'core', surfaceKeys: ['web'], intent: 'internal-doc', terms: DOCUMENT_HOST_TERMS, proximity: 20, bonus: 24 },

    // ---- docs: the surfaces that hold work product, not marketing ---------
    {
        tier: 'docs',
        surfaceKeys: ['gdocs', 'gdrive', 'gdrive-folders', 'gdocs-published', 'gslides', 'gsheets', 'canva', 'pptx', 'docx', 'pdf', 'notion', 'xlsx', 'dropbox', 'airtable', 'notion-so', 'slideshare', 'pitch', 'figma', 'miro'],
        intent: 'internal-doc',
        terms: CLAIM_TERMS['internal-doc'],
        bonus: 10,
    },
    {
        tier: 'docs',
        surfaceKeys: ['gdocs', 'gdrive', 'gdrive-folders', 'gslides', 'canva', 'pptx', 'pdf', 'notion', 'docx'],
        intent: 'results',
        terms: CLAIM_TERMS.results,
        bonus: 8,
    },
    {
        tier: 'docs',
        surfaceKeys: ['gdocs', 'gslides', 'pdf', 'pptx', 'docx', 'canva'],
        intent: 'contract',
        terms: CLAIM_TERMS.contract,
        bonus: 6,
    },
    {
        tier: 'docs',
        surfaceKeys: ['pdf', 'pptx', 'slideshare', 'canva', 'gslides', 'notion'],
        intent: 'case-study',
        terms: CLAIM_TERMS['case-study'],
        bonus: 4,
    },

    // ---- social: the claim, made out loud --------------------------------
    { tier: 'social', surfaceKeys: ['li-profile', 'li-company', 'x', 'medium'], intent: 'role', terms: CLAIM_TERMS.role, bonus: 10 },
    { tier: 'social', surfaceKeys: ['li-post', 'li-pulse', 'x', 'youtube', 'substack'], intent: 'results', terms: CLAIM_TERMS.results, bonus: 8 },
    { tier: 'social', surfaceKeys: ['li-post', 'li-company', 'youtube', 'medium'], intent: 'case-study', terms: CLAIM_TERMS['case-study'], bonus: 6 },
    { tier: 'social', surfaceKeys: ['li-profile', 'x', 'reddit', 'threads'], intent: 'client-roster', terms: CLAIM_TERMS['client-roster'], bonus: 4 },

    // ---- directories: the roster, already structured ---------------------
    { tier: 'directories', surfaceKeys: ['clutch', 'upwork', 'contra', 'designrush', 'goodfirms', 'sortlist'], intent: 'client-roster', terms: CLAIM_TERMS['client-roster'], bonus: 8 },
    { tier: 'directories', surfaceKeys: ['clutch', 'upwork', 'contra', 'wellfound', 'podcasts'], intent: 'case-study', terms: CLAIM_TERMS['case-study'], bonus: 4 },

    // ---- wide: the long tail, run last and only if asked ------------------
    { tier: 'wide', surfaceKeys: ['web'], intent: 'results', terms: ['scaled from', 'took them from', 'grew from', 'went from'], proximity: 20 },
    { tier: 'wide', surfaceKeys: ['web'], intent: 'contract', terms: ['prepared for', 'prepared by', 'in partnership with'], proximity: 8 },
    { tier: 'wide', surfaceKeys: ['web'], intent: 'role', terms: ['agency of record', 'growth agency', 'creative agency', 'media buying agency'], proximity: 20 },
    { tier: 'wide', surfaceKeys: ['web'], intent: 'portfolio', terms: ['testimonial', 'review', 'loved working with'], proximity: 20 },
];

/**
 * Builds the query set for one brand.
 *
 * Queries come back sorted by weight and capped, so the caller can hand the
 * whole list to a SERP provider and know the budget went to the surfaces most
 * likely to name a real operator.
 */
export function buildDorks(target: DorkTarget, opts: DorkOptions): DorkQuery[] {
    const aliases = uniq([target.brand, ...target.aliases].filter(Boolean));
    const entity = anyOf(aliases.slice(0, 3));
    if (!entity) return [];

    const notOwn = exclusions(target, opts);
    const dates = dateWindow(opts);
    const tiers = new Set(opts.tiers.length > 0 ? opts.tiers : DORK_TIERS);
    const seen = new Set<string>();
    const queries: DorkQuery[] = [];

    const push = (
        tier: DorkTier,
        surfaceKey: string,
        surfaceOperator: string,
        surfaceWeight: number,
        recipe: Recipe,
    ): void => {
        const claim = anyOf(recipe.terms);
        if (!claim) return;

        const head = recipe.proximity
            ? around(entity, claim, recipe.proximity)
            : `${entity} ${claim}`;
        const tail = [surfaceOperator, recipe.operator ?? '', notOwn, dates].filter(Boolean).join(' ');

        // Trim the claim group, not the surface or the exclusions, to fit.
        const prefix = recipe.proximity ? `${entity} AROUND(${recipe.proximity})` : entity;
        const query = wordBudget(`${head} ${tail}`) > MAX_QUERY_WORDS
            ? fitWords(prefix, recipe.terms, tail)
            : [head, tail].filter(Boolean).join(' ');

        const key = query.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);

        queries.push({
            id: `${tier}:${surfaceKey}:${recipe.intent}:${queries.length}`,
            tier,
            surface: surfaceKey,
            intent: recipe.intent,
            query,
            weight: Math.min(100, surfaceWeight + (recipe.bonus ?? 0)),
        });
    };

    for (const recipe of RECIPES) {
        if (!tiers.has(recipe.tier)) continue;
        for (const key of recipe.surfaceKeys) {
            const surface = SURFACE_BY_KEY.get(key);
            if (!surface) continue;
            push(recipe.tier, surface.key, surface.operator, surface.weight, recipe);
        }
    }

    // A bare citation of the domain, anywhere but the brand's own site, is the
    // cheapest way to find agencies that name the client only by link.
    if (tiers.has('core') && target.domain) {
        push('core', 'web', '', 70, {
            tier: 'core',
            surfaceKeys: ['web'],
            intent: 'client-roster',
            terms: ['case study', 'client', 'roas', 'we scaled'],
            operator: `"${target.domain}"`,
            bonus: 12,
        });
    }

    // Caller-supplied surfaces ride the strongest core recipes.
    for (const extra of opts.extraSurfaces ?? []) {
        const operator = extra.trim();
        if (!operator || !tiers.has('core')) continue;
        push('core', operator, operator, 70, {
            tier: 'core',
            surfaceKeys: [],
            intent: 'case-study',
            terms: CLAIM_TERMS['case-study'],
            bonus: 10,
        });
    }

    return capAcrossTiers(queries, Math.max(1, opts.maxQueries))
        .sort((a, b) => b.weight - a.weight)
        .map((q, index) => ({ ...q, id: `q${index + 1}` }));
}

/**
 * Applies the query cap by taking turns between tiers.
 *
 * A straight weight sort does not work here: the document surfaces carry the
 * highest weights by design — an open media plan really is worth more than a
 * blog post — and there are forty of them, so a cap of 25 would spend the
 * whole budget on Drive and never run the core case-study dorks that find
 * most agencies. Round-robin guarantees every enabled tier contributes its
 * own strongest queries, and a tier that runs out hands its turns back.
 */
export function capAcrossTiers(queries: DorkQuery[], max: number): DorkQuery[] {
    const buckets = new Map<DorkTier, DorkQuery[]>();
    for (const query of queries) {
        const bucket = buckets.get(query.tier) ?? [];
        bucket.push(query);
        buckets.set(query.tier, bucket);
    }
    for (const bucket of buckets.values()) bucket.sort((a, b) => b.weight - a.weight);

    const order = DORK_TIERS.filter((tier) => buckets.has(tier));
    const taken: DorkQuery[] = [];
    const cursors = new Map<DorkTier, number>(order.map((tier) => [tier, 0]));

    while (taken.length < max) {
        let progressed = false;
        for (const tier of order) {
            if (taken.length >= max) break;
            const bucket = buckets.get(tier) ?? [];
            const cursor = cursors.get(tier) ?? 0;
            const next = bucket[cursor];
            if (!next) continue;
            cursors.set(tier, cursor + 1);
            taken.push(next);
            progressed = true;
        }
        if (!progressed) break;
    }

    return taken;
}
