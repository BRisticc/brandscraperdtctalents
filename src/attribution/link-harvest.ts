/**
 * The second hop.
 *
 * Dorking `site:drive.google.com` directly has a low ceiling, and the reason
 * is structural rather than a matter of writing a better query: a Drive file
 * or folder page renders in JavaScript, so even when Google has the URL there
 * is little more than a title to match against. Worse, a Drive link is only
 * in the index at all once something crawlable has linked to it — Drive
 * publishes no sitemap of everyone's "anyone with the link" files.
 *
 * That last point is also the way in. If a document is indexed, some public
 * page linked it; and the pages that link an agency's media plan are exactly
 * the pages the other dork tiers already find — its Notion wiki, a LinkedIn
 * post, a newsletter, a resources page. So instead of asking Google for the
 * documents, this module reads the documents' links off the pages the dorks
 * already opened, and sends them back through verification.
 */

import type { CheerioAPI } from 'cheerio';
import { normaliseUrl } from '../util/domain.js';
import { uniq } from '../util/text.js';

/** Document hosts worth following, mapped onto the surface they score as. */
const DOCUMENT_HOSTS: Array<{ test: RegExp; surface: string }> = [
    { test: /^docs\.google\.com$/, surface: 'gdocs' },
    { test: /^drive\.google\.com$/, surface: 'gdrive' },
    { test: /^(www\.)?canva\.com$/, surface: 'canva' },
    { test: /(^|\.)notion\.site$/, surface: 'notion' },
    { test: /^(www\.)?notion\.so$/, surface: 'notion-so' },
    { test: /^(www\.)?slideshare\.net$/, surface: 'slideshare' },
    { test: /^(www\.)?pitch\.com$/, surface: 'pitch' },
    { test: /^(www\.)?airtable\.com$/, surface: 'airtable' },
    { test: /^(www\.)?dropbox\.com$/, surface: 'dropbox' },
    { test: /^(www\.)?figma\.com$/, surface: 'figma' },
    { test: /^(www\.)?miro\.com$/, surface: 'miro' },
];

/** Google paths that are never somebody's work product. */
const NOT_WORK_PRODUCT = /\/(forms|viewform|drawings|gview|open\?|uc\?|accounts|settings)/i;

/**
 * The surface a harvested link scores as, or null when it is not a document.
 * Google Docs are split by kind so a slide deck is not scored as a text doc.
 */
export function surfaceForDocumentUrl(rawUrl: string, extraHosts: string[] = []): string | null {
    let parsed: URL;
    try {
        parsed = new URL(rawUrl);
    } catch {
        return null;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;

    const host = parsed.hostname.toLowerCase();
    if (NOT_WORK_PRODUCT.test(parsed.pathname + parsed.search)) return null;

    const match = DOCUMENT_HOSTS.find((entry) => entry.test.test(host));
    if (!match) {
        // Caller-supplied hosts — a company wiki, a Coda space, a file server.
        // They get the generic surface weight rather than a per-product one.
        const extra = extraHosts.some((raw) => {
            const clean = raw.trim().toLowerCase().replace(/^www\./, '');
            return clean !== '' && (host === clean || host.endsWith(`.${clean}`));
        });
        return extra ? 'linked-doc' : null;
    }

    if (match.surface === 'gdocs') {
        if (/\/presentation\//.test(parsed.pathname)) return 'gslides';
        if (/\/spreadsheets\//.test(parsed.pathname)) return 'gsheets';
        if (!/\/document\//.test(parsed.pathname)) return null;
    }
    if (match.surface === 'canva' && !/\/design\//.test(parsed.pathname)) return null;
    if (match.surface === 'gdrive' && !/\/(file|drive|folderview)/.test(parsed.pathname)) return null;

    return match.surface;
}

export interface HarvestedLink {
    url: string;
    surface: string;
    /** The page the link was found on, kept for the evidence trail. */
    sourceUrl: string;
}

/**
 * Pulls every document link off one page.
 *
 * Deliberately indiscriminate about *where* on the page a link sits: an
 * agency's open media plan is as likely to be in a footer "resources" list as
 * in the body. Relevance is decided later, by opening the document and
 * checking whether it names the brand — the same bar every other hit clears.
 */
export interface HarvestOptions {
    max?: number;
    /** Extra hosts to treat as document hosts, e.g. a company wiki. */
    extraHosts?: string[];
}

export function harvestDocumentLinks($: CheerioAPI, pageUrl: string, opts: HarvestOptions = {}): HarvestedLink[] {
    const max = opts.max ?? 25;
    const extraHosts = opts.extraHosts ?? [];
    const found: HarvestedLink[] = [];
    const seen = new Set<string>();

    $('a[href]').each((_, el) => {
        if (found.length >= max) return false;
        const href = $(el).attr('href');
        if (!href) return undefined;

        const abs = normaliseUrl(href, pageUrl);
        if (!abs) return undefined;

        const surface = surfaceForDocumentUrl(abs, extraHosts);
        if (!surface || seen.has(abs)) return undefined;

        seen.add(abs);
        found.push({ url: abs, surface, sourceUrl: pageUrl });
        return undefined;
    });

    return found;
}

/**
 * Google Docs URLs carry a share token that changes nothing about which
 * document is being opened, so two links to the same deck must not cost two
 * fetches. Collapses to the document id where there is one.
 */
export function documentIdentity(rawUrl: string): string {
    // .../document/d/<id>/edit, .../presentation/d/e/<id>/pub, .../file/d/<id>/view
    const google = /\/(document|presentation|spreadsheets|file)\/d\/(?:e\/)?([A-Za-z0-9_-]{6,})/.exec(rawUrl);
    if (google) return `${google[1]}:${google[2]}`;

    const folder = /\/folders\/([A-Za-z0-9_-]{6,})/.exec(rawUrl);
    if (folder) return `folder:${folder[1]}`;

    // Canva appends a per-share token after the design id.
    const design = /\/design\/([A-Za-z0-9_-]{6,})/.exec(rawUrl);
    if (design) return `design:${design[1]}`;

    return normaliseUrl(rawUrl) ?? rawUrl;
}

/** Dedupes harvested links by document identity, keeping the first seen. */
export function dedupeHarvest(links: HarvestedLink[]): HarvestedLink[] {
    const byIdentity = new Map<string, HarvestedLink>();
    for (const link of links) {
        const key = documentIdentity(link.url);
        if (!byIdentity.has(key)) byIdentity.set(key, link);
    }
    return [...byIdentity.values()];
}

export const DOCUMENT_HOST_PATTERNS = DOCUMENT_HOSTS;

/** The hosts, as search terms, for the dork that finds the pages doing the linking. */
export const DOCUMENT_HOST_TERMS = uniq([
    'docs.google.com', 'drive.google.com', 'canva.com', 'notion.site', 'dropbox.com',
]);
