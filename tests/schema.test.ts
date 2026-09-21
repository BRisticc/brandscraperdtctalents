import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseInput } from '../src/input.js';

interface SchemaProperty {
    title?: string;
    type?: string;
    description?: string;
    editor?: string;
    enum?: string[];
    enumTitles?: string[];
    default?: unknown;
    items?: { enum?: string[]; enumTitles?: string[] };
    minimum?: number;
    maximum?: number;
}

interface InputSchema {
    title: string;
    type: string;
    schemaVersion: number;
    properties: Record<string, SchemaProperty>;
    required?: string[];
}

// Read from disk rather than importing: the file must be valid as shipped,
// not as TypeScript happens to resolve it.
const schema = JSON.parse(readFileSync('.actor/input_schema.json', 'utf8')) as InputSchema;
const actorJson = JSON.parse(readFileSync('.actor/actor.json', 'utf8')) as Record<string, unknown>;

describe('input schema shape', () => {
    it('declares the fields the Apify build requires', () => {
        assert.equal(schema.schemaVersion, 1);
        assert.equal(schema.type, 'object');
        assert.ok(schema.title);
    });

    // The Apify build rejects the whole actor if any one property is missing
    // title, type or description.
    it('gives every property a title, type and description', () => {
        const incomplete = Object.entries(schema.properties)
            .filter(([, prop]) => !prop.title || !prop.type || !prop.description)
            .map(([name]) => name);
        assert.deepEqual(incomplete, []);
    });

    it('keeps enum and enumTitles the same length wherever both are given', () => {
        for (const [name, prop] of Object.entries(schema.properties)) {
            if (prop.enum && prop.enumTitles) {
                assert.equal(prop.enum.length, prop.enumTitles.length, `${name}: enum/enumTitles mismatch`);
            }
            if (prop.items?.enum && prop.items.enumTitles) {
                assert.equal(prop.items.enum.length, prop.items.enumTitles.length, `${name}: items mismatch`);
            }
        }
    });

    it('only marks properties that exist as required', () => {
        for (const name of schema.required ?? []) {
            assert.ok(schema.properties[name], `required field "${name}" is not declared`);
        }
    });

    it('points actor.json at this schema', () => {
        assert.equal(actorJson.input, './input_schema.json');
        assert.equal(actorJson.dockerfile, './Dockerfile');
    });
});

describe('schema and parser agree', () => {
    const base = { brandNames: ['My Patriot Supply'] };

    // Drift between the UI enum and what parseInput accepts is silent and
    // nasty: the user picks a value the actor then quietly discards.
    it('accepts every "serpProvider" value the schema offers', () => {
        const values = schema.properties.serpProvider?.enum;
        assert.ok(values && values.length > 0);
        for (const value of values) {
            assert.equal(parseInput({ ...base, serpProvider: value }).serpProvider, value);
        }
    });

    it('accepts every dorkTiers value the schema offers', () => {
        const values = schema.properties.dorkTiers?.items?.enum;
        assert.ok(values && values.length > 0);
        for (const value of values) {
            assert.deepEqual(parseInput({ ...base, dorkTiers: [value] }).dorkTiers, [value]);
        }
    });

    it('accepts every outputFormats value the schema offers', () => {
        const values = schema.properties.outputFormats?.items?.enum;
        assert.ok(values && values.length > 0);
        for (const value of values) {
            assert.deepEqual(parseInput({ ...base, outputFormats: [value] }).outputFormats, [value]);
        }
    });

    const defaults: Array<[string, unknown]> = [
        ['resolveBrandSites', true],
        ['serpProvider', 'auto'],
        ['serpApifyActorId', 'apify/google-search-scraper'],
        ['serpCountry', 'us'],
        ['serpLanguage', 'en'],
        ['maxDorkQueries', 40],
        ['resultsPerDork', 10],
        ['maxClaimPagesPerBrand', 60],
        ['maxHarvestedPages', 40],
        ['minClaimScore', 45],
        ['maxConcurrency', 5],
        ['requestTimeoutSecs', 30],
        ['maxRequestRetries', 3],
    ];

    it('documents the same defaults the parser applies', () => {
        const parsed = parseInput(base) as unknown as Record<string, unknown>;
        for (const [field, expected] of defaults) {
            assert.equal(schema.properties[field]?.default, expected, `${field}: schema default disagrees`);
            assert.equal(parsed[field], expected, `${field}: parser default disagrees`);
        }
    });

    it('defaults dorkTiers to what the schema advertises', () => {
        assert.deepEqual(parseInput(base).dorkTiers, schema.properties.dorkTiers?.default);
    });

    it('clamps to the bounds the schema advertises', () => {
        for (const [field, prop] of Object.entries(schema.properties)) {
            if (prop.type !== 'integer' || prop.minimum === undefined || prop.maximum === undefined) continue;
            const low = parseInput({ ...base, [field]: prop.minimum - 1000 }) as unknown as Record<string, number>;
            const high = parseInput({ ...base, [field]: prop.maximum + 1000 }) as unknown as Record<string, number>;
            assert.equal(low[field], prop.minimum, `${field} should clamp up to its documented minimum`);
            assert.equal(high[field], prop.maximum, `${field} should clamp down to its documented maximum`);
        }
    });
});

describe('the shipped examples are runnable', () => {
    const files = readdirSync('examples').filter((f) => f.endsWith('.json'));

    it('ships at least one example', () => {
        assert.ok(files.length > 0);
    });

    for (const file of files) {
        it(`${file} parses and survives parseInput`, () => {
            const raw = JSON.parse(readFileSync(`examples/${file}`, 'utf8')) as Record<string, unknown>;
            assert.doesNotThrow(() => parseInput(raw));
        });

        // An example naming a field the schema does not declare would be
        // silently ignored by the Apify UI, which is worse than failing.
        it(`${file} only uses fields the schema declares`, () => {
            const raw = JSON.parse(readFileSync(`examples/${file}`, 'utf8')) as Record<string, unknown>;
            const unknown = Object.keys(raw).filter((key) => !schema.properties[key]);
            assert.deepEqual(unknown, [], `${file} sets undeclared fields: ${unknown.join(', ')}`);
        });
    }
});

describe('scripts/run-remote.mjs builds input this actor accepts', () => {
    // Imported by absolute path: the compiled test lives under dist-tests/,
    // so a relative specifier would not find the script.
    const load = async () => await import(
        pathToFileURL(resolve('scripts/run-remote.mjs')).href
    ) as { buildInput: (args: Record<string, unknown>) => Record<string, unknown> };

    it('produces input that survives parseInput unchanged', async () => {
        const { buildInput } = await load();
        const parsed = parseInput(buildInput({
            brand: 'My Patriot Supply, Nutrient Survival',
            aliases: 'Ready Hour',
            tiers: 'core, docs',
            hosts: 'coda.io',
            after: '2024-01-01',
            hop: '120',
            min_score: '35',
        }));
        assert.deepEqual(parsed.brandNames, ['My Patriot Supply', 'Nutrient Survival']);
        assert.deepEqual(parsed.extraBrandAliases, ['Ready Hour']);
        assert.deepEqual(parsed.dorkTiers, ['core', 'docs']);
        assert.deepEqual(parsed.extraDocumentHosts, ['coda.io']);
        assert.equal(parsed.dorkAfterDate, '2024-01-01');
        assert.equal(parsed.maxHarvestedPages, 120);
        assert.equal(parsed.minClaimScore, 35);
    });

    it('rejects a run with no brand before any network call', async () => {
        const { buildInput } = await load();
        assert.throws(() => buildInput({}), /--brand is required/);
    });

    it('does not run main() on import', async () => {
        // Importing twice must stay silent; a side-effecting module would
        // have tried to reach the API the first time.
        await load();
        await load();
        assert.ok(true);
    });
});
