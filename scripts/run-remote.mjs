/**
 * Runs this actor on the Apify platform and downloads the report.
 *
 *   APIFY_TOKEN=... node scripts/run-remote.mjs --brand "My Patriot Supply"
 *   APIFY_TOKEN=... node scripts/run-remote.mjs --brand "A, B" --tiers core,docs --after 2024-01-01
 *
 * The token is read from the environment only — never from argv, so it does
 * not end up in shell history or a process listing.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ACTOR_NAME = 'agency-attribution';
const API = 'https://api.apify.com/v2';

function parseArgs(argv) {
    const args = {};
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (!arg.startsWith('--')) continue;
        const key = arg.slice(2);
        const next = argv[i + 1];
        if (next === undefined || next.startsWith('--')) args[key] = true;
        else { args[key] = next; i += 1; }
    }
    return args;
}

/** `--x "a, b"` → ['a', 'b']; absent or bare → []. */
function list(value) {
    if (typeof value !== 'string') return [];
    return value.split(',').map((item) => item.trim()).filter(Boolean);
}

export function buildInput(args) {
    const brands = list(args.brand);
    if (brands.length === 0) {
        throw new Error('--brand is required, e.g. --brand "My Patriot Supply" (comma-separate for several).');
    }

    const input = {
        brandNames: brands,
        outputFormats: ['json', 'markdown', 'html'],
        proxyConfiguration: { useApifyProxy: true },
    };

    const aliases = list(args.aliases);
    if (aliases.length > 0) input.extraBrandAliases = aliases;

    const tiers = list(args.tiers);
    if (tiers.length > 0) input.dorkTiers = tiers;

    const surfaces = list(args.surfaces);
    if (surfaces.length > 0) input.extraDorkSurfaces = surfaces;

    const hosts = list(args.hosts);
    if (hosts.length > 0) input.extraDocumentHosts = hosts;

    const exclude = list(args.exclude);
    if (exclude.length > 0) input.excludeDomains = exclude;

    if (typeof args.after === 'string') input.dorkAfterDate = args.after;
    if (typeof args.before === 'string') input.dorkBeforeDate = args.before;
    if (typeof args.country === 'string') input.serpCountry = args.country;
    if (typeof args.language === 'string') input.serpLanguage = args.language;

    const numbers = [
        ['dorks', 'maxDorkQueries'],
        ['results', 'resultsPerDork'],
        ['pages', 'maxClaimPagesPerBrand'],
        ['hop', 'maxHarvestedPages'],
        ['min_score', 'minClaimScore'],
        ['concurrency', 'maxConcurrency'],
    ];
    for (const [flag, field] of numbers) {
        if (args[flag] !== undefined && args[flag] !== true) input[field] = Number(args[flag]);
    }

    // `--no-resolve` skips the one plain query per brand that finds its domain.
    if (args['no-resolve'] !== undefined) input.resolveBrandSites = false;

    return input;
}

/**
 * Turns a failed response into a message that says which side failed.
 *
 * A 403 can come from Apify (bad or revoked token) or from a proxy/firewall
 * between you and Apify that never let the request out. Those need opposite
 * fixes, and the raw status alone sends people to rotate a token that was
 * fine all along.
 */
export function describeHttpFailure(method, path, status, body) {
    const text = String(body ?? '').trim();
    const head = `${method} ${path} -> HTTP ${status}`;

    let apifyError = null;
    try {
        apifyError = JSON.parse(text)?.error ?? null;
    } catch { /* not JSON: almost certainly not Apify talking */ }

    if (apifyError && (apifyError.message || apifyError.type)) {
        const detail = apifyError.message ?? apifyError.type;
        const hint = status === 401 || /token/i.test(String(apifyError.type))
            ? '\n  Apify rejected the credentials. Check APIFY_TOKEN is current and not revoked.'
            : '';
        return `${head}: Apify says "${detail}"${hint}`;
    }

    if (/allowlist|egress|not allowed|blocked|proxy|CONNECT|tunnel/i.test(text)) {
        return `${head}: ${text.slice(0, 300)}`
            + '\n  This came from a proxy or firewall, not from Apify — the request never reached the API.'
            + '\n  Your token is not the problem. Allow api.apify.com in the network egress settings and retry.';
    }

    return `${head}: ${text.slice(0, 300) || '(empty response body)'}`;
}

async function api(path, token, options = {}) {
    const sep = path.includes('?') ? '&' : '?';
    const url = `${API}${path}${sep}token=${encodeURIComponent(token)}`;

    let response;
    try {
        response = await fetch(url, options);
    } catch (err) {
        throw new Error(`${options.method ?? 'GET'} ${path} could not connect: ${err.message}`
            + '\n  Nothing reached api.apify.com. Check network access to it before suspecting the token.');
    }

    const text = await response.text();
    if (!response.ok) {
        throw new Error(describeHttpFailure(options.method ?? 'GET', path, response.status, text));
    }
    return text;
}

async function apiJson(path, token, options) {
    return JSON.parse(await api(path, token, options));
}

async function resolveActorId(token, override) {
    if (typeof override === 'string') return override;
    const { data } = await apiJson('/acts?limit=1000', token);
    const matches = (data?.items ?? []).filter((a) => a.name === ACTOR_NAME);
    if (matches.length === 1) return matches[0].id;
    if (matches.length === 0) {
        throw new Error(`No actor named "${ACTOR_NAME}" on this account. Build it first, or pass --actor <actorId>.`);
    }
    throw new Error(`Several actors named "${ACTOR_NAME}". Pass --actor <actorId> to pick one.`);
}

const TERMINAL = new Set(['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT', 'ABORTING']);

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const input = buildInput(args);

    if (args['dry-run']) {
        console.log(JSON.stringify(input, null, 2));
        return;
    }

    const token = process.env.APIFY_TOKEN;
    if (!token) throw new Error('Set APIFY_TOKEN in the environment (not as an argument).');

    const outDir = typeof args.out === 'string' ? args.out : 'out';
    mkdirSync(outDir, { recursive: true });

    const actorId = await resolveActorId(token, args.actor);
    console.log(`Actor ${actorId} — starting run for ${input.brandNames.join(', ')}`);

    const started = await apiJson(`/acts/${actorId}/runs`, token, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
    });

    const runId = started.data.id;
    console.log(`Run ${runId}: https://console.apify.com/actors/runs/${runId}`);

    let run = started.data;
    while (!TERMINAL.has(run.status)) {
        await new Promise((r) => { setTimeout(r, 5000); });
        run = (await apiJson(`/actor-runs/${runId}`, token)).data;
        process.stdout.write(`\r  status: ${run.status}   `);
    }
    console.log(`\nFinished: ${run.status}`);

    if (run.status !== 'SUCCEEDED') {
        const log = await api(`/actor-runs/${runId}/log`, token);
        const logPath = join(outDir, `${runId}.log`);
        writeFileSync(logPath, log);
        console.error(`Run did not succeed. Full log written to ${logPath}`);
        console.error(log.split('\n').slice(-25).join('\n'));
        process.exitCode = 1;
        return;
    }

    for (const record of ['REPORT.md', 'REPORT.html', 'REPORT.json']) {
        try {
            const body = await api(`/key-value-stores/${run.defaultKeyValueStoreId}/records/${record}`, token);
            writeFileSync(join(outDir, record), body);
            console.log(`  wrote ${join(outDir, record)}`);
        } catch {
            console.log(`  (no ${record} in this run)`);
        }
    }

    const items = await apiJson(`/datasets/${run.defaultDatasetId}/items?format=json&clean=true`, token);
    writeFileSync(join(outDir, 'dataset.json'), JSON.stringify(items, null, 2));
    console.log(`  wrote ${join(outDir, 'dataset.json')} — ${items.length} brand(s)`);

    for (const brand of items) {
        console.log(`    ${brand.brandName} → ${brand.niche} / ${brand.subNiche}`
            + `${brand.audience ? ` (${brand.audience})` : ''} [${brand.classificationConfidence}]`
            + ` · ${brand.adCount} ads · top angle: ${brand.topAngle ?? 'n/a'}`);
    }
}

// Only run when invoked directly, so buildInput can be imported and tested
// without the script firing off an API call as a side effect of the import.
const invokedDirectly = process.argv[1]
    && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (invokedDirectly) {
    main().catch((err) => {
        console.error(`Error: ${err.message}`);
        process.exitCode = 1;
    });
}
