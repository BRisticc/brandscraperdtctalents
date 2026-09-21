import { gotScraping } from 'crawlee';

export interface FetchOptions {
    timeoutSecs: number;
    retries: number;
    proxyUrl?: string;
}

export interface FetchResult {
    url: string;
    body: string;
    statusCode: number;
    contentType: string;
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504, 522, 524]);

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => { setTimeout(resolve, ms); });
}

/**
 * Plain HTTP GET with browser-ish headers, exponential backoff and an
 * explicit "this is not HTML" guard. Used for the per-brand side fetches
 * (products.json, about pages) that sit outside the Crawlee queue.
 */
export async function fetchPage(url: string, opts: FetchOptions): Promise<FetchResult> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= opts.retries; attempt++) {
        if (attempt > 0) await sleep(Math.min(8000, 2 ** attempt * 500));
        try {
            const response = await gotScraping({
                url,
                timeout: { request: opts.timeoutSecs * 1000 },
                proxyUrl: opts.proxyUrl,
                throwHttpErrors: false,
                followRedirect: true,
                retry: { limit: 0 },
                headers: { accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8' },
            });
            const status = response.statusCode;
            if (RETRYABLE_STATUS.has(status) && attempt < opts.retries) {
                lastError = new Error(`HTTP ${status}`);
                continue;
            }
            return {
                url: response.url || url,
                body: typeof response.body === 'string' ? response.body : String(response.body ?? ''),
                statusCode: status,
                contentType: String(response.headers['content-type'] ?? ''),
            };
        } catch (err) {
            lastError = err;
        }
    }
    throw lastError instanceof Error ? lastError : new Error(`Failed to fetch ${url}`);
}

/** GET + JSON.parse, returning null instead of throwing on any failure. */
export async function fetchJson<T>(url: string, opts: FetchOptions): Promise<T | null> {
    try {
        const res = await fetchPage(url, opts);
        if (res.statusCode >= 400) return null;
        return JSON.parse(res.body) as T;
    } catch {
        return null;
    }
}

/** Runs tasks with bounded concurrency, preserving input order in the result. */
export async function mapWithConcurrency<T, R>(
    items: T[],
    limit: number,
    worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
    const results = new Array<R>(items.length);
    let cursor = 0;
    const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
        while (cursor < items.length) {
            const index = cursor++;
            const item = items[index];
            if (item === undefined) continue;
            results[index] = await worker(item, index);
        }
    });
    await Promise.all(runners);
    return results;
}
