/**
 * Making the doc surfaces readable.
 *
 * `site:docs.google.com` is the highest-value dork in the set and the one
 * whose results are useless out of the box: the URL Google indexes renders
 * its text in JavaScript, so a plain fetch of a Doc returns an empty shell.
 *
 * Every one of those products does publish a server-rendered view — an export
 * endpoint, or a static HTML projection — and they are not guessable. This
 * module maps an indexed URL onto the readable one, which is the difference
 * between "found a document" and "read the document".
 */

export interface ReadableTarget {
    /** The URL to actually fetch. */
    url: string;
    /** How to parse what comes back. */
    format: 'html' | 'text' | 'csv';
    /** True when the original URL was rewritten. */
    rewritten: boolean;
    /** Why the rewrite happened, for the evidence trail. */
    note?: string;
}

const GDOC_ID = /\/(document|presentation|spreadsheets)\/d\/(e\/)?([A-Za-z0-9_-]{8,})/;

/**
 * Rewrites an indexed URL to one that returns text to a plain HTTP GET.
 *
 * Published-to-web variants (`/pub`, `/pubhtml`) are already static, so they
 * are left alone; only the editor/view URLs need the export endpoint.
 */
export function readableUrl(rawUrl: string): ReadableTarget {
    let parsed: URL;
    try {
        parsed = new URL(rawUrl);
    } catch {
        return { url: rawUrl, format: 'html', rewritten: false };
    }

    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const path = parsed.pathname;

    if (host === 'docs.google.com') {
        // Anything already published to the web serves static HTML.
        if (/\/(pub|pubhtml|htmlview|htmlpresent)$/.test(path)) {
            return { url: rawUrl, format: 'html', rewritten: false };
        }
        const match = GDOC_ID.exec(path);
        if (match) {
            const kind = match[1];
            const published = Boolean(match[2]);
            const id = match[3];
            const base = `https://docs.google.com/${kind}/d/${published ? 'e/' : ''}${id}`;
            if (kind === 'document') {
                return { url: `${base}/export?format=txt`, format: 'text', rewritten: true, note: 'Google Doc read via text export' };
            }
            if (kind === 'presentation') {
                // htmlpresent is the only slides projection that is plain HTML.
                return { url: `${base}/htmlpresent`, format: 'html', rewritten: true, note: 'Google Slides read via htmlpresent' };
            }
            return { url: `${base}/export?format=csv`, format: 'csv', rewritten: true, note: 'Google Sheet read via CSV export' };
        }
    }

    // Drive file/folder pages render in JS, but the shell still carries the
    // file name in <title> and og:title — enough to name the artefact.
    if (host === 'drive.google.com') {
        return { url: rawUrl, format: 'html', rewritten: false, note: 'Drive listing: title only, contents not indexed' };
    }

    // Canva view links are JS-rendered; the og: tags are not.
    if (host === 'canva.com') {
        return { url: rawUrl, format: 'html', rewritten: false, note: 'Canva design: title and description only' };
    }

    return { url: rawUrl, format: 'html', rewritten: false };
}

/** Content types that carry no readable text for our purposes. */
const BINARY_CONTENT = /(image|video|audio|font|octet-stream|zip|pdf|powerpoint|presentationml|wordprocessingml|sheet|excel)/i;

export function isBinaryContentType(contentType: string): boolean {
    return BINARY_CONTENT.test(contentType);
}
