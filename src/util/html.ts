import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';

export function load(html: string): CheerioAPI {
    return cheerio.load(html);
}

/** Strips a page to the text a reader would see. */
export function htmlToText($: CheerioAPI): string {
    $('script, style, noscript, svg, iframe, template').remove();
    const body = $('body').text() || $.root().text();
    return body.replace(/\s+/g, ' ').trim();
}
