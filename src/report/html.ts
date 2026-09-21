import type { AgencyAttribution, RunReport } from '../types.js';
import { escapeHtml, truncate } from '../util/text.js';

const STYLE = `
:root { color-scheme: light dark; --bg:#fbfaf8; --fg:#1b1a18; --muted:#6b6862; --line:#e3e0da;
  --card:#ffffff; --accent:#a8552c; --chip:#f0ede7; }
@media (prefers-color-scheme: dark) {
  :root { --bg:#16151a; --fg:#eceaf2; --muted:#a09dab; --line:#2d2b34; --card:#1e1d24; --accent:#e0855a; --chip:#282630; }
}
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--fg);
  font:15px/1.6 ui-sans-serif,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; }
.wrap { max-width: 1080px; margin:0 auto; padding: 32px 20px 72px; }
h1 { font-size: 1.9rem; margin:0 0 4px; letter-spacing:-.02em; }
h2 { font-size: 1.25rem; margin: 40px 0 12px; letter-spacing:-.01em; }
h3 { font-size: 1.05rem; margin: 0 0 6px; }
.sub { color: var(--muted); margin: 0 0 24px; }
.stats { display:flex; flex-wrap:wrap; gap:10px; margin: 0 0 8px; }
.stat { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:10px 14px; min-width:110px; }
.stat b { display:block; font-size:1.35rem; line-height:1.2; }
.stat span { color:var(--muted); font-size:.8rem; }
.warn { background:var(--chip); border-left:3px solid var(--accent); border-radius:6px; padding:12px 14px; margin:12px 0; }
.card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:18px 20px; margin:14px 0; }
.meta { color:var(--muted); font-size:.87rem; margin:2px 0; }
table { width:100%; border-collapse:collapse; font-size:.9rem; }
.scroll { overflow-x:auto; }
th,td { text-align:left; padding:8px 10px; border-bottom:1px solid var(--line); vertical-align:top; }
th { color:var(--muted); font-weight:600; font-size:.8rem; text-transform:uppercase; letter-spacing:.04em; }
td.num, th.num { text-align:right; white-space:nowrap; }
.chip { display:inline-block; background:var(--chip); border-radius:999px; padding:2px 10px; font-size:.78rem; margin:2px 4px 2px 0; }
.score { display:inline-block; background:var(--accent); color:#fff; border-radius:6px;
  padding:1px 7px; font-size:.8rem; font-weight:600; }
blockquote { margin:8px 0; padding:8px 0 8px 12px; border-left:3px solid var(--line);
  color:var(--fg); font-size:.9rem; }
code { background:var(--chip); border-radius:4px; padding:1px 6px; font-size:.82rem;
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace; word-break:break-word; }
a { color:var(--accent); }
footer { color:var(--muted); font-size:.82rem; margin-top:48px; border-top:1px solid var(--line); padding-top:16px; }
`;

function brandCard(attribution: AgencyAttribution): string {
    const parts: string[] = [];
    parts.push('<div class="card">');
    parts.push(`<h3>${escapeHtml(attribution.brand)}${attribution.domain ? ` <span class="meta">${escapeHtml(attribution.domain)}</span>` : ''}</h3>`);
    parts.push(
        `<p class="meta">${attribution.queries.length} dorks · ${attribution.resultsSeen} results · `
        + `${attribution.documentsHarvested} linked document(s) followed · `
        + `${attribution.resultsVerified} pages read · ${attribution.claims.length} operator(s)</p>`,
    );

    if (attribution.claims.length === 0) {
        parts.push('<p class="meta">Nobody cleared the confidence bar for this brand.</p>');
    } else {
        parts.push('<div class="scroll"><table><thead><tr><th class="num">Score</th><th>Who</th><th>Type</th><th>Found on</th><th>Roles</th><th>Results claimed</th></tr></thead><tbody>');
        for (const claim of attribution.claims.slice(0, 20)) {
            const who = claim.claimant.profileUrl
                ? `<a href="${escapeHtml(claim.claimant.profileUrl)}" rel="nofollow noopener">${escapeHtml(claim.claimant.name)}</a>`
                : escapeHtml(claim.claimant.name);
            const surfaces = claim.surfaces.slice(0, 4).map((s) => `<span class="chip">${escapeHtml(s)}</span>`).join('');
            parts.push(
                `<tr><td class="num"><span class="score">${claim.score}</span></td><td>${who}</td>`
                + `<td>${escapeHtml(claim.claimant.kind)}${claim.verified ? '' : ' <span class="chip">unverified</span>'}</td>`
                + `<td>${surfaces}</td><td class="meta">${escapeHtml(claim.roles.slice(0, 3).join(', ')) || '—'}</td>`
                + `<td class="meta">${escapeHtml(claim.metrics.slice(0, 3).join(', ')) || '—'}</td></tr>`,
            );
        }
        parts.push('</tbody></table></div>');

        for (const claim of attribution.claims.slice(0, 8)) {
            const best = claim.evidence[0];
            if (!best) continue;
            const how = best.linkedFrom
                ? `linked from <code>${escapeHtml(truncate(best.linkedFrom, 90))}</code>`
                : `<code>${escapeHtml(truncate(best.query, 160))}</code>`;
            parts.push(`<p class="meta"><b>${escapeHtml(claim.claimant.name)}</b> — ${escapeHtml(best.surfaceLabel)} · ${how}</p>`);
            parts.push(`<blockquote>${escapeHtml(truncate(best.quote, 400))}</blockquote>`);
            parts.push(`<p class="meta"><a href="${escapeHtml(best.url)}" rel="nofollow noopener">${escapeHtml(truncate(best.url, 110))}</a></p>`);
        }
    }

    if (attribution.unattributed.length > 0) {
        parts.push('<p class="meta">Pages about this brand that named nobody we could resolve:</p><ul class="meta">');
        for (const hit of attribution.unattributed.slice(0, 8)) {
            parts.push(`<li><a href="${escapeHtml(hit.url)}" rel="nofollow noopener">${escapeHtml(truncate(hit.title || hit.url, 110))}</a> — ${escapeHtml(hit.surfaceLabel)} (${hit.score})</li>`);
        }
        parts.push('</ul>');
    }

    parts.push('</div>');
    return parts.join('\n');
}

export function renderHtml(report: RunReport): string {
    const parts: string[] = [];
    parts.push('<!doctype html><html lang="en"><head><meta charset="utf-8">');
    parts.push('<meta name="viewport" content="width=device-width, initial-scale=1">');
    parts.push('<title>Who runs these brands</title>');
    parts.push(`<style>${STYLE}</style></head><body><div class="wrap">`);

    parts.push('<h1>Who runs these brands</h1>');
    parts.push(`<p class="sub">Generated ${escapeHtml(report.generatedAt)} · search via ${escapeHtml(report.serpProvider)}</p>`);

    parts.push('<div class="stats">');
    for (const [label, value] of [
        ['Brands', report.brandsResearched],
        ['Dorks run', report.dorksRun],
        ['Results', report.resultsSeen],
        ['Linked documents', report.documentsHarvested],
        ['Pages read', report.pagesRead],
        ['Operators', report.operatorsFound],
    ] as Array<[string, number]>) {
        parts.push(`<div class="stat"><b>${value}</b><span>${escapeHtml(label)}</span></div>`);
    }
    parts.push('</div>');

    for (const warning of report.warnings) {
        parts.push(`<div class="warn">${escapeHtml(warning)}</div>`);
    }

    if (report.operatorLeaderboard.length > 0) {
        parts.push('<h2>Operator leaderboard</h2><div class="scroll"><table><thead><tr><th class="num">Score</th><th>Operator</th><th>Type</th><th>Brands claimed</th><th>Found on</th><th>Roles</th></tr></thead><tbody>');
        for (const row of report.operatorLeaderboard.slice(0, 50)) {
            const who = row.profileUrl
                ? `<a href="${escapeHtml(row.profileUrl)}" rel="nofollow noopener">${escapeHtml(row.name)}</a>`
                : escapeHtml(row.name);
            const brands = row.brands.map((b) => `<span class="chip">${escapeHtml(b)}</span>`).join('');
            const surfaces = row.surfaces.slice(0, 4).map((s) => `<span class="chip">${escapeHtml(s)}</span>`).join('');
            parts.push(
                `<tr><td class="num"><span class="score">${row.bestScore}</span></td><td>${who}</td>`
                + `<td>${escapeHtml(row.kind)}</td><td>${brands}</td><td>${surfaces}</td>`
                + `<td class="meta">${escapeHtml(row.roles.slice(0, 3).join(', ')) || '—'}</td></tr>`,
            );
        }
        parts.push('</tbody></table></div>');
    }

    parts.push('<h2>Brands</h2>');
    for (const row of report.brands) parts.push(brandCard(row.attribution));

    parts.push('<footer>Scores are comparable within this run only. A page that could not be opened and read is capped at 34, so an unverified snippet never outranks a page whose body was checked for the brand. Every claim links the page it came from — check it before acting on it.</footer>');
    parts.push('</div></body></html>');
    return parts.join('\n');
}
