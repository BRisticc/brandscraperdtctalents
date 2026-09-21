/**
 * Turning a page into a name.
 *
 * A dork hit is a URL. What the user wants is "Hazel & Co ran this account"
 * or "Marko Ilic was the creative strategist". Two different jobs get you
 * there:
 *
 *   URL-shaped claimants — LinkedIn, Upwork, Clutch, an agency's own site.
 *     The identity is in the host and path, and is reliable.
 *   Document-shaped claimants — a Google Doc, a Canva deck, a PDF.
 *     The URL says nothing; the identity is a footer, a "prepared by" line
 *     or a contact email inside the file.
 */

import { brandNameFromDomain, hostOf, isDeniedDomain, registrableDomain } from '../util/domain.js';
import { collapseWhitespace, titleCase, truncate, uniq } from '../util/text.js';

export type ClaimantKind = 'agency' | 'person' | 'unknown';

export interface Claimant {
    /** Dedupe key: the domain for an agency, platform+handle for a person. */
    key: string;
    kind: ClaimantKind;
    name: string;
    /** The agency's own registrable domain, once we know it. */
    domain?: string;
    /** Where the identity was read from. */
    profileUrl?: string;
    handle?: string;
    platform?: string;
    /** 0-100 confidence that this is really a distinct operator. */
    confidence: number;
}

/** Hosts that host other people's identities, so are never the claimant. */
const PLATFORM_HOSTS = new Set([
    'linkedin.com', 'x.com', 'twitter.com', 'medium.com', 'substack.com', 'reddit.com',
    'youtube.com', 'youtu.be', 'threads.net', 'facebook.com', 'instagram.com', 'tiktok.com',
    'docs.google.com', 'drive.google.com', 'sites.google.com', 'canva.com', 'notion.site',
    'notion.so', 'slideshare.net', 'pitch.com', 'figma.com', 'miro.com', 'airtable.com',
    'dropbox.com', 'box.com', 'upwork.com', 'contra.com', 'clutch.co', 'designrush.com',
    'goodfirms.co', 'sortlist.com', 'wellfound.com', 'podcasts.apple.com', 'listennotes.com',
    'github.com', 'gitlab.com', 'calendly.com', 'typeform.com', 'loom.com', 'vimeo.com',
]);

const FREE_EMAIL_HOSTS = new Set([
    'gmail.com', 'googlemail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'live.com',
    'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'mail.com',
    'yandex.com', 'zoho.com', 'msn.com',
]);

export function isPlatformHost(domain: string): boolean {
    return PLATFORM_HOSTS.has(domain);
}

/** Strips LinkedIn/X/YouTube title furniture down to the human part. */
function nameFromTitle(title: string, platform: string): string {
    let clean = collapseWhitespace(title);
    clean = clean.replace(/\s*[|\-–—]\s*(LinkedIn|X|Twitter|Medium|Upwork|Clutch\.co|Contra|YouTube|SlideShare).*$/i, '');
    if (platform === 'linkedin') {
        // "Ana Kovac - Head of Growth at Studio X" → the part before the dash.
        const head = clean.split(/\s+[-–—]\s+/)[0];
        if (head) clean = head;
    }
    if (platform === 'x') clean = clean.replace(/\s+on X:.*$/i, '').replace(/^["“]/, '');
    return truncate(clean, 120);
}

function handleToName(handle: string): string {
    return titleCase(handle.replace(/[._-]+/g, ' ').replace(/\d+$/, '').trim()) || handle;
}

/**
 * Reads the claimant off the result URL, where the platform encodes it.
 * Returns null for surfaces that carry no identity in the URL (a Google Doc,
 * a Reddit thread) — those go to `claimantsFromText`.
 */
export function claimantFromUrl(url: string, title: string, brandDomains: string[] = []): Claimant | null {
    const host = hostOf(url);
    const domain = registrableDomain(url);
    if (!host || !domain) return null;

    let path = '';
    try {
        path = new URL(url).pathname;
    } catch {
        return null;
    }
    const segments = path.split('/').filter(Boolean);

    const li = /^\/(in|company)\/([^/]+)/.exec(path);
    if (domain === 'linkedin.com' && li) {
        const kind: ClaimantKind = li[1] === 'in' ? 'person' : 'agency';
        const handle = decodeURIComponent(li[2] ?? '');
        return {
            key: `linkedin:${handle.toLowerCase()}`,
            kind,
            name: nameFromTitle(title, 'linkedin') || handleToName(handle),
            profileUrl: `https://www.linkedin.com/${li[1]}/${handle}`,
            handle,
            platform: 'linkedin',
            confidence: kind === 'person' ? 85 : 80,
        };
    }
    if (domain === 'linkedin.com' && segments[0] === 'posts' && segments[1]) {
        // Post slugs start with the author's public identifier.
        const author = (segments[1].split('_')[0] ?? '').toLowerCase();
        if (author.length >= 3) {
            return {
                key: `linkedin:${author}`,
                kind: 'person',
                name: nameFromTitle(title, 'linkedin') || handleToName(author),
                profileUrl: `https://www.linkedin.com/in/${author}`,
                handle: author,
                platform: 'linkedin',
                confidence: 70,
            };
        }
    }

    if ((domain === 'x.com' || domain === 'twitter.com') && segments[0] && !['search', 'hashtag', 'i', 'home'].includes(segments[0])) {
        const handle = segments[0];
        return {
            key: `x:${handle.toLowerCase()}`,
            kind: 'person',
            name: nameFromTitle(title, 'x') || `@${handle}`,
            profileUrl: `https://x.com/${handle}`,
            handle,
            platform: 'x',
            confidence: 70,
        };
    }

    if (domain === 'upwork.com' && segments[0] === 'freelancers' && segments[1]) {
        return {
            key: `upwork:${segments[1].toLowerCase()}`,
            kind: 'person',
            name: nameFromTitle(title, 'upwork'),
            profileUrl: url,
            handle: segments[1],
            platform: 'upwork',
            confidence: 78,
        };
    }
    if (domain === 'upwork.com' && segments[0] === 'agencies' && segments[1]) {
        return {
            key: `upwork-agency:${segments[1].toLowerCase()}`,
            kind: 'agency',
            name: nameFromTitle(title, 'upwork'),
            profileUrl: url,
            handle: segments[1],
            platform: 'upwork',
            confidence: 78,
        };
    }

    if (domain === 'contra.com' && segments[0] && segments[0] !== 'search') {
        return {
            key: `contra:${segments[0].toLowerCase()}`,
            kind: 'person',
            name: nameFromTitle(title, 'contra') || handleToName(segments[0]),
            profileUrl: `https://contra.com/${segments[0]}`,
            handle: segments[0],
            platform: 'contra',
            confidence: 72,
        };
    }

    if (domain === 'clutch.co' && segments[0] === 'profile' && segments[1]) {
        return {
            key: `clutch:${segments[1].toLowerCase()}`,
            kind: 'agency',
            name: nameFromTitle(title, 'clutch') || handleToName(segments[1]),
            profileUrl: url,
            handle: segments[1],
            platform: 'clutch',
            confidence: 80,
        };
    }

    const handleSeg = segments.find((s) => s.startsWith('@'));
    if ((domain === 'medium.com' || domain === 'youtube.com') && handleSeg) {
        const handle = handleSeg.slice(1);
        return {
            key: `${domain.split('.')[0]}:${handle.toLowerCase()}`,
            kind: 'person',
            name: nameFromTitle(title, domain) || handleToName(handle),
            profileUrl: `https://${domain}/@${handle}`,
            handle,
            platform: domain.split('.')[0] ?? domain,
            confidence: 62,
        };
    }

    if (domain === 'slideshare.net' && segments[0]) {
        return {
            key: `slideshare:${segments[0].toLowerCase()}`,
            kind: 'agency',
            name: handleToName(segments[0]),
            profileUrl: `https://www.slideshare.net/${segments[0]}`,
            handle: segments[0],
            platform: 'slideshare',
            confidence: 58,
        };
    }

    // Not a platform: the site itself is the claimant. This is the common case
    // for "agency publishes a case study on its own blog".
    if (!isPlatformHost(domain) && !isDeniedDomain(domain) && !brandDomains.includes(domain)) {
        return {
            key: `site:${domain}`,
            kind: 'agency',
            name: brandNameFromDomain(domain),
            domain,
            profileUrl: `https://${domain}`,
            platform: 'own-site',
            confidence: 72,
        };
    }

    return null;
}

/**
 * Credit lines, matched case-insensitively on the lead phrase but strictly on
 * the name: decks write "Prepared by", "PREPARED BY" and "prepared by", and a
 * single case-insensitive regex would also have to accept a lower-case name,
 * which drags in half the surrounding sentence.
 */
const CREDIT_LEADS = [
    'prepared by', 'presented by', 'created by', 'produced by', 'written by',
    'deck by', 'report by', 'author:',
];
// The name continues on its own line only: a credit line ends at the line
// break, and `\s+` would happily swallow the next sentence's first word.
const NAME_AFTER = /^[ \t]*[:\-–]?[ \t]*\n?[ \t]*([A-Z][\w'&.-]*(?:[ \t]+[A-Z][\w'&.-]*){0,4})/;

export function creditedNames(text: string): string[] {
    const lower = text.toLowerCase();
    const names: string[] = [];
    for (const lead of CREDIT_LEADS) {
        let from = 0;
        for (;;) {
            const at = lower.indexOf(lead, from);
            if (at < 0) break;
            from = at + lead.length;
            const match = NAME_AFTER.exec(text.slice(from, from + 120));
            const name = collapseWhitespace(match?.[1] ?? '');
            if (name) names.push(name);
            if (names.length >= 10) return names;
        }
    }
    return names;
}
const EMAIL = /\b[\w.+-]+@([a-z0-9-]+(?:\.[a-z0-9-]+)+)\b/gi;
const BARE_DOMAIN = /\b((?:[a-z0-9-]+\.)+(?:com|co|io|agency|studio|media|marketing|digital|net|org|co\.uk|xyz|ai))\b/gi;

/**
 * Reads claimants out of a document's own text.
 *
 * Used for the doc surfaces, where the URL is anonymous. A contact email on a
 * non-free domain is the strongest single signal in here: nobody puts
 * hello@theiragency.com in a media plan they did not write.
 */
export function claimantsFromText(text: string, brandDomains: string[] = []): Claimant[] {
    const found = new Map<string, Claimant>();
    const body = text.slice(0, 40_000);

    for (const match of body.matchAll(EMAIL)) {
        const emailDomain = (match[1] ?? '').toLowerCase().replace(/^www\./, '');
        if (!emailDomain || FREE_EMAIL_HOSTS.has(emailDomain)) continue;
        if (isPlatformHost(emailDomain) || isDeniedDomain(emailDomain) || brandDomains.includes(emailDomain)) continue;
        found.set(`site:${emailDomain}`, {
            key: `site:${emailDomain}`,
            kind: 'agency',
            name: brandNameFromDomain(emailDomain),
            domain: emailDomain,
            profileUrl: `https://${emailDomain}`,
            platform: 'document',
            confidence: 82,
        });
    }

    for (const name of creditedNames(body)) {
        if (name.length < 3 || name.length > 80) continue;
        const key = `name:${name.toLowerCase()}`;
        if (found.has(key)) continue;
        found.set(key, {
            key,
            kind: /\b(agency|studio|media|marketing|labs|group|co|collective|partners)\b/i.test(name) ? 'agency' : 'person',
            name,
            platform: 'document',
            confidence: 68,
        });
    }

    // A bare domain in a deck footer, when no email was found.
    if (found.size === 0) {
        for (const match of body.matchAll(BARE_DOMAIN)) {
            const domain = (match[1] ?? '').toLowerCase().replace(/^www\./, '');
            if (FREE_EMAIL_HOSTS.has(domain)) continue;
            if (isPlatformHost(domain) || isDeniedDomain(domain) || brandDomains.includes(domain)) continue;
            if (domain.split('.')[0]!.length < 4) continue;
            found.set(`site:${domain}`, {
                key: `site:${domain}`,
                kind: 'agency',
                name: brandNameFromDomain(domain),
                domain,
                profileUrl: `https://${domain}`,
                platform: 'document',
                confidence: 52,
            });
            if (found.size >= 3) break;
        }
    }

    return [...found.values()].sort((a, b) => b.confidence - a.confidence);
}

/** Merges two readings of the same claimant, keeping the better-evidenced one. */
export function mergeClaimant(a: Claimant, b: Claimant): Claimant {
    const better = b.confidence > a.confidence ? b : a;
    const other = better === a ? b : a;
    return {
        ...better,
        name: better.name || other.name,
        domain: better.domain ?? other.domain,
        profileUrl: better.profileUrl ?? other.profileUrl,
        handle: better.handle ?? other.handle,
        kind: better.kind === 'unknown' ? other.kind : better.kind,
        confidence: Math.min(100, Math.max(a.confidence, b.confidence) + 4),
    };
}

export const FREE_EMAIL_HOST_LIST = FREE_EMAIL_HOSTS;
export const PLATFORM_HOST_LIST = PLATFORM_HOSTS;

/** Used by the report to describe a set of claimants in one line. */
export function describeClaimants(claimants: Claimant[]): string {
    return uniq(claimants.map((c) => c.name)).slice(0, 5).join(', ');
}
