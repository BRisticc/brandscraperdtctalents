/**
 * Apify's ProxyConfiguration.newUrl() validates the session id against
 * /^[\w._~]+$/ and throws otherwise — notably, a hyphen is not allowed.
 *
 * The rule is enforced deep inside the SDK, so an id built by string
 * interpolation ("brand-0") only blows up at run time, and only when a proxy
 * is actually configured. This normalises any label into a legal id so that
 * cannot happen, wherever the label comes from.
 */

/** The exact pattern the Apify SDK enforces. */
export const PROXY_SESSION_ID_RE = /^[\w._~]+$/;

const MAX_LENGTH = 50;

export function proxySessionId(label: string): string {
    const cleaned = label
        .normalize('NFKD')
        .replace(/[^\w._~]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, MAX_LENGTH);
    // An all-illegal label (or an empty one) would otherwise normalise to "".
    return cleaned.length > 0 ? cleaned : 'session';
}
