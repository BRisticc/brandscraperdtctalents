import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { InputError, parseInput, resolveSerpProvider } from '../src/input.js';

describe('input parsing', () => {
    it('requires at least one brand name', () => {
        assert.throws(() => parseInput({}), InputError);
        assert.throws(() => parseInput({ brandNames: [] }), InputError);
        assert.throws(() => parseInput({ brandNames: ['  ', ''] }), InputError);
    });

    it('trims and keeps the brand names given', () => {
        assert.deepEqual(parseInput({ brandNames: [' My Patriot Supply ', ''] }).brandNames, ['My Patriot Supply']);
    });

    it('applies documented defaults', () => {
        const input = parseInput({ brandNames: ['a'] });
        assert.equal(input.serpProvider, 'auto');
        assert.equal(input.serpApifyActorId, 'apify/google-search-scraper');
        assert.deepEqual(input.dorkTiers, ['core', 'docs', 'social', 'directories']);
        assert.equal(input.maxDorkQueries, 40);
        assert.equal(input.maxHarvestedPages, 40);
        assert.equal(input.minClaimScore, 45);
        assert.equal(input.resolveBrandSites, true);
    });

    it('clamps numeric fields into range instead of failing', () => {
        const input = parseInput({ brandNames: ['a'], maxDorkQueries: 9999, resultsPerDork: 0, maxHarvestedPages: -5 });
        assert.equal(input.maxDorkQueries, 300);
        assert.equal(input.resultsPerDork, 1);
        assert.equal(input.maxHarvestedPages, 0);
    });

    it('rejects a dork date that Google would silently ignore', () => {
        assert.throws(() => parseInput({ brandNames: ['a'], dorkAfterDate: 'last year' }), /dorkAfterDate must be an ISO date/);
        assert.equal(parseInput({ brandNames: ['a'], dorkAfterDate: '2024-01-01' }).dorkAfterDate, '2024-01-01');
    });

    it('drops unknown dork tiers and never ends up with an empty tier list', () => {
        assert.deepEqual(parseInput({ brandNames: ['a'], dorkTiers: ['core', 'telepathy'] }).dorkTiers, ['core']);
        assert.deepEqual(
            parseInput({ brandNames: ['a'], dorkTiers: ['telepathy'] }).dorkTiers,
            ['core', 'docs', 'social', 'directories'],
        );
    });

    it('accepts a pasted URL where a host is wanted', () => {
        const input = parseInput({
            brandNames: ['a'],
            extraDocumentHosts: ['https://www.Coda.io/d/Plan', ' quip.com '],
            excludeDomains: ['HTTPS://WWW.Example.com/pages/about'],
        });
        assert.deepEqual(input.extraDocumentHosts, ['coda.io', 'quip.com']);
        assert.deepEqual(input.excludeDomains, ['example.com']);
    });

    it('keeps only valid output formats', () => {
        assert.deepEqual(parseInput({ brandNames: ['a'], outputFormats: ['markdown', 'pdf'] }).outputFormats, ['markdown']);
        assert.deepEqual(
            parseInput({ brandNames: ['a'], outputFormats: ['pdf'] }).outputFormats,
            ['json', 'markdown', 'html'],
        );
    });

    it('turns the run off rather than half-configuring it without a token', () => {
        const input = parseInput({ brandNames: ['a'] });
        assert.equal(resolveSerpProvider(input, false), 'none');
        assert.equal(resolveSerpProvider(input, true), 'apify-actor');
        assert.equal(resolveSerpProvider(parseInput({ brandNames: ['a'], serpProvider: 'none' }), true), 'none');
    });
});
