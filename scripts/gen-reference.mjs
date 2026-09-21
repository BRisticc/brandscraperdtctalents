/**
 * Regenerates docs/reference.md from the source, so the documented dork
 * grammar can never drift from the queries the actor actually runs.
 *
 *   npm run docs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { SURFACES, CLAIM_TERMS, DORK_TIERS, buildDorks } from '../dist/attribution/dorks.js';

const lines = [];
lines.push('# Reference: the dork grammar');
lines.push('');
lines.push('_Generated from the source by `npm run docs`. Do not edit by hand._');
lines.push('');

lines.push(`## Surfaces — ${SURFACES.length} places practitioners leave fingerprints`);
lines.push('');
lines.push('Weight is "how strongly does a hit here mean this person ran the account", not "how likely is a hit". Extend the catalogue with the `extraDorkSurfaces` input.');
lines.push('');

for (const tier of DORK_TIERS) {
    const inTier = SURFACES.filter((s) => s.tier === tier && !s.linkOnly);
    if (inTier.length === 0) continue;
    lines.push(`### Tier \`${tier}\``);
    lines.push('');
    lines.push('| Surface | Operator | Weight | Readable without a browser |');
    lines.push('| --- | --- | ---: | --- |');
    for (const surface of inTier.sort((a, b) => b.weight - a.weight)) {
        lines.push(`| ${surface.label} | \`${surface.operator || '(none)'}\` | ${surface.weight} | ${surface.needsRewrite ? 'via a URL rewrite' : 'yes'} |`);
    }
    lines.push('');
}

const linkOnly = SURFACES.filter((s) => s.linkOnly);
if (linkOnly.length > 0) {
    lines.push('### Reached by link, never dorked');
    lines.push('');
    lines.push('Documents linked from a page the dorks already opened. Google indexes a Drive file only once something crawlable has linked it, so following those links reaches material no `site:` query reliably returns.');
    lines.push('');
    lines.push('| Surface | Weight |');
    lines.push('| --- | ---: |');
    for (const surface of linkOnly) lines.push(`| ${surface.label} | ${surface.weight} |`);
    lines.push('');
}

lines.push('## Claim vocabulary');
lines.push('');
lines.push('The language practitioners use *about* a brand, never the language a brand uses about itself. That asymmetry does most of the filtering for free.');
lines.push('');
lines.push('| Intent | Phrases |');
lines.push('| --- | --- |');
for (const [intent, terms] of Object.entries(CLAIM_TERMS)) {
    lines.push(`| \`${intent}\` | ${terms.map((t) => `\`${t}\``).join(', ')} |`);
}
lines.push('');

const sample = buildDorks(
    { brand: 'My Patriot Supply', aliases: ['Ready Hour'], domain: 'mypatriotsupply.com' },
    { tiers: [...DORK_TIERS], maxQueries: 25 },
);
lines.push('## Sample queries');
lines.push('');
lines.push('The 25 highest-weighted dorks generated for `My Patriot Supply` (alias `Ready Hour`, domain `mypatriotsupply.com`). Paste any of them straight into Google.');
lines.push('');
lines.push('| # | Tier | Intent | Query |');
lines.push('| --- | --- | --- | --- |');
for (const dork of sample) {
    lines.push(`| ${dork.id} | ${dork.tier} | ${dork.intent} | \`${dork.query.replace(/\|/g, '\\|')}\` |`);
}
lines.push('');

mkdirSync('docs', { recursive: true });
writeFileSync('docs/reference.md', `${lines.join('\n')}\n`);
console.log(`Wrote docs/reference.md — ${SURFACES.length} surfaces, ${sample.length} sample queries.`);
