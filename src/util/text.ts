/** Text helpers shared across the pipeline. */

export function collapseWhitespace(input: string): string {
    return input.replace(/\s+/g, ' ').trim();
}

/** Lower-cases, strips accents and punctuation noise, collapses whitespace. */
export function normalise(input: string): string {
    return collapseWhitespace(
        input
            .toLowerCase()
            .normalize('NFKD')
            .replace(/[̀-ͯ]/g, '')
            .replace(/[’‘`]/g, "'")
            .replace(/[“”]/g, '"')
            .replace(/[^a-z0-9%$£€'".,!?/+\-\s]/g, ' '),
    );
}

/**
 * Counts whole-word occurrences of a term (single word or phrase) in
 * already-normalised text. Phrases match across a single space.
 */
export function countTerm(normalisedText: string, term: string): number {
    const needle = normalise(term);
    if (!needle) return 0;
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    const re = new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, 'g');
    return (normalisedText.match(re) ?? []).length;
}

export function truncate(input: string, max: number): string {
    const clean = collapseWhitespace(input);
    if (clean.length <= max) return clean;
    return `${clean.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

export function uniq<T>(items: T[]): T[] {
    return [...new Set(items)];
}

export function titleCase(input: string): string {
    return input.replace(/\w\S*/g, (t) => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase());
}

export function escapeHtml(input: string): string {
    return input
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
