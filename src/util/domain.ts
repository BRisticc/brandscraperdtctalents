/** Suffixes that need two labels kept, e.g. "brand.co.uk" not "co.uk". */
const MULTI_PART_SUFFIXES = new Set([
    'co.uk', 'org.uk', 'me.uk', 'ac.uk', 'gov.uk', 'net.uk', 'ltd.uk', 'plc.uk',
    'com.au', 'net.au', 'org.au', 'id.au', 'edu.au', 'gov.au',
    'co.nz', 'net.nz', 'org.nz', 'co.za', 'org.za', 'web.za',
    'com.br', 'net.br', 'org.br', 'com.mx', 'com.ar', 'com.co', 'com.pe',
    'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'co.kr', 'or.kr',
    'com.cn', 'net.cn', 'org.cn', 'com.hk', 'com.sg', 'com.my', 'com.tw',
    'co.in', 'net.in', 'org.in', 'firm.in', 'gen.in',
    'com.tr', 'com.ua', 'co.il', 'com.sa', 'com.eg', 'com.ng', 'co.ke',
    'com.es', 'com.pl', 'com.pt', 'com.gr', 'com.ro', 'com.vn', 'co.id', 'co.th',
]);

/**
 * Hosts that are never a brand's own site and never an operator's own agency.
 *
 * Two jobs: it stops a retailer being mistaken for the brand when a name is
 * resolved to a domain, and it stops a marketplace or publisher being named
 * as the agency behind an account.
 */
const DENY_HOSTS = new Set([
    // marketplaces / retailers — they stock brands, they are not the brand
    'amazon.com', 'amazon.co.uk', 'amazon.de', 'amazon.ca', 'amazon.com.au',
    'ebay.com', 'walmart.com', 'target.com', 'costco.com', 'etsy.com',
    'sephora.com', 'ulta.com', 'cvs.com', 'walgreens.com', 'iherb.com',
    'gnc.com', 'vitaminshoppe.com', 'bodybuilding.com', 'chemistwarehouse.com.au',
    'boots.com', 'superdrug.com', 'hollandandbarrett.com',
    'shopify.com', 'myshopify.com', 'bigcommerce.com', 'squarespace.com', 'wix.com',
    // publishers / reference
    'wikipedia.org', 'wikimedia.org', 'nytimes.com', 'forbes.com', 'businessinsider.com',
    'healthline.com', 'webmd.com', 'menshealth.com', 'womenshealthmag.com', 'gq.com',
    'vogue.com', 'allure.com', 'cosmopolitan.com', 'buzzfeed.com',
    'nih.gov', 'ncbi.nlm.nih.gov', 'pubmed.ncbi.nlm.nih.gov', 'fda.gov', 'mayoclinic.org',
    'consumerreports.org', 'trustpilot.com', 'sitejabber.com', 'yelp.com', 'bbb.org',
    // infra / tooling / trackers
    'google.com', 'googleapis.com', 'gstatic.com', 'doubleclick.net', 'googletagmanager.com',
    'cloudflare.com', 'cloudfront.net', 'akamaihd.net', 'jsdelivr.net', 'unpkg.com',
    'gravatar.com', 'w3.org', 'schema.org', 'apple.com', 'microsoft.com', 'adobe.com',
    'paypal.com', 'stripe.com', 'klarna.com', 'afterpay.com', 'affirm.com',
    'mailchimp.com', 'hubspot.com', 'zendesk.com', 'intercom.com',
    'archive.org', 'bit.ly', 'tinyurl.com', 'linktr.ee',
]);

export function normaliseUrl(raw: string, base?: string): string | null {
    try {
        const u = new URL(raw, base);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
        u.hash = '';
        // Strip tracking params so the same page does not dedupe as two.
        for (const key of [...u.searchParams.keys()]) {
            if (/^(utm_|fbclid|gclid|msclkid|ref|referrer|source|mc_cid|mc_eid|igshid)/i.test(key)) {
                u.searchParams.delete(key);
            }
        }
        return u.toString();
    } catch {
        return null;
    }
}

export function hostOf(url: string): string | null {
    try {
        return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    } catch {
        return null;
    }
}

/** "shop.eu.hims.com" -> "hims.com"; "brand.co.uk" -> "brand.co.uk". */
export function registrableDomain(url: string): string | null {
    const host = hostOf(url);
    if (!host || !host.includes('.')) return null;
    const parts = host.split('.');
    if (parts.length <= 2) return host;
    const lastTwo = parts.slice(-2).join('.');
    if (MULTI_PART_SUFFIXES.has(lastTwo)) return parts.slice(-3).join('.');
    return lastTwo;
}

export function isDeniedDomain(domain: string, extraDeny: string[] = []): boolean {
    if (DENY_HOSTS.has(domain)) return true;
    for (const d of extraDeny) {
        const clean = d.trim().toLowerCase().replace(/^www\./, '');
        if (clean && (domain === clean || domain.endsWith(`.${clean}`))) return true;
    }
    return false;
}

/** "hazelmedia.co" -> "Hazelmedia"; the fallback when no better name is known. */
export function brandNameFromDomain(domain: string): string {
    const stem = domain.split('.')[0] ?? domain;
    return stem
        .replace(/[-_]+/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase())
        .trim();
}

export const DENY_HOST_LIST = DENY_HOSTS;
