import type { AgencyAttribution, RunReport } from '../types.js';
import { truncate } from '../util/text.js';

function mdEscape(input: string): string {
    return input.replace(/\|/g, '\\|').replace(/\n+/g, ' ');
}

/**
 * The evidence block for one brand.
 *
 * Every row carries its own quote and source URL rather than a bare score:
 * the whole point of this actor is that a human can check the claim in one
 * click, and a number nobody can audit is worth nothing for hiring or
 * competitive work.
 */
function brandSection(attribution: AgencyAttribution): string {
    const lines: string[] = [];
    lines.push(`## ${attribution.brand}${attribution.domain ? ` (${attribution.domain})` : ''}`);
    lines.push('');
    lines.push(
        `_${attribution.queries.length} dorks · ${attribution.resultsSeen} results · `
        + `${attribution.documentsHarvested} linked document(s) followed · `
        + `${attribution.resultsVerified} pages read · ${attribution.claims.length} operator(s)_`,
    );
    lines.push('');

    if (attribution.claims.length === 0) {
        lines.push('Nobody cleared the confidence bar for this brand.');
        lines.push('');
    } else {
        lines.push('| Score | Who | Type | Found on | Roles | Results claimed |');
        lines.push('| ---: | --- | --- | --- | --- | --- |');
        for (const claim of attribution.claims.slice(0, 20)) {
            const who = claim.claimant.profileUrl
                ? `[${mdEscape(claim.claimant.name)}](${claim.claimant.profileUrl})`
                : mdEscape(claim.claimant.name);
            lines.push(
                `| ${claim.score} | ${who} | ${claim.claimant.kind}${claim.verified ? '' : ' _(unverified)_'} `
                + `| ${mdEscape(claim.surfaces.slice(0, 4).join(', '))} `
                + `| ${mdEscape(claim.roles.slice(0, 3).join(', ')) || '—'} `
                + `| ${mdEscape(claim.metrics.slice(0, 3).join(', ')) || '—'} |`,
            );
        }
        lines.push('');

        for (const claim of attribution.claims.slice(0, 8)) {
            const best = claim.evidence[0];
            if (!best) continue;
            const how = best.linkedFrom
                ? `linked from ${mdEscape(truncate(best.linkedFrom, 90))}`
                : `via \`${mdEscape(best.query)}\``;
            lines.push(`**${mdEscape(claim.claimant.name)}** — ${best.surfaceLabel}, ${how}`);
            lines.push('');
            lines.push(`> ${mdEscape(truncate(best.quote, 400))}`);
            lines.push('');
            lines.push(`  ${best.url}`);
            lines.push('');
        }
    }

    if (attribution.unattributed.length > 0) {
        lines.push('_Pages about this brand that named nobody we could resolve:_');
        lines.push('');
        for (const hit of attribution.unattributed.slice(0, 8)) {
            lines.push(`- [${mdEscape(hit.title || hit.url)}](${hit.url}) — ${hit.surfaceLabel} (${hit.score})`);
        }
        lines.push('');
    }

    return lines.join('\n');
}

export function renderMarkdown(report: RunReport): string {
    const lines: string[] = [];

    lines.push('# Who runs these brands');
    lines.push('');
    lines.push(`Generated ${report.generatedAt} · search via ${report.serpProvider}`);
    lines.push('');
    lines.push(
        `**${report.brandsResearched} brand(s)** · ${report.dorksRun} dorks · ${report.resultsSeen} results · `
        + `${report.documentsHarvested} linked documents · ${report.pagesRead} pages read · `
        + `${report.operatorsFound} operators`,
    );
    lines.push('');

    if (report.warnings.length > 0) {
        lines.push('## Read this first');
        lines.push('');
        for (const warning of report.warnings) lines.push(`- ${warning}`);
        lines.push('');
    }

    if (report.operatorLeaderboard.length > 0) {
        lines.push('## Operator leaderboard');
        lines.push('');
        lines.push('| Score | Operator | Type | Brands claimed | Found on | Roles |');
        lines.push('| ---: | --- | --- | --- | --- | --- |');
        for (const row of report.operatorLeaderboard.slice(0, 50)) {
            const who = row.profileUrl ? `[${mdEscape(row.name)}](${row.profileUrl})` : mdEscape(row.name);
            lines.push(
                `| ${row.bestScore} | ${who} | ${row.kind} | ${mdEscape(row.brands.join(', '))} `
                + `| ${mdEscape(row.surfaces.slice(0, 4).join(', '))} `
                + `| ${mdEscape(row.roles.slice(0, 3).join(', ')) || '—'} |`,
            );
        }
        lines.push('');
    }

    for (const row of report.brands) lines.push(brandSection(row.attribution));

    return lines.join('\n');
}
