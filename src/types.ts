/**
 * The pipeline in one line:
 *
 *   brand name -> dorks -> SERP -> open every hit -> follow the documents
 *   they link -> read who is claiming credit -> ranked operators
 */
export type { AgencyAttribution, AgencyClaim, AttributionTarget } from './attribution/attribution.js';
export type { ClaimEvidence } from './attribution/verify.js';
export type { Claimant, ClaimantKind } from './attribution/claimants.js';
export type { DorkQuery, DorkTier, DorkIntent, Surface } from './attribution/dorks.js';
export type { SerpResult } from './attribution/serp.js';
export type { HarvestedLink } from './attribution/link-harvest.js';
export type { ResolvedBrand } from './attribution/resolve.js';

import type { AgencyAttribution } from './attribution/attribution.js';
import type { ClaimantKind } from './attribution/claimants.js';

/** One dataset row: everything found for one brand. */
export interface BrandAttributionRow {
    brand: string;
    domain?: string;
    aliases: string[];
    /** Flat mirrors of the strongest claim, so the dataset table reads well. */
    topOperator?: string;
    topOperatorScore?: number;
    topOperatorKind?: ClaimantKind;
    operatorCount: number;
    dorksRun: number;
    resultsSeen: number;
    documentsHarvested: number;
    pagesRead: number;
    attribution: AgencyAttribution;
    scrapedAt: string;
}

/** Cross-brand rollup saved to the key-value store. */
export interface RunReport {
    generatedAt: string;
    brandsResearched: number;
    dorksRun: number;
    resultsSeen: number;
    documentsHarvested: number;
    pagesRead: number;
    operatorsFound: number;
    serpProvider: string;
    /**
     * Every operator found across the run, with the brands they claim.
     * An operator who turns up against several brands is the single most
     * useful row this actor produces.
     */
    operatorLeaderboard: Array<{
        name: string;
        kind: ClaimantKind;
        profileUrl?: string;
        domain?: string;
        brands: string[];
        surfaces: string[];
        roles: string[];
        metrics: string[];
        bestScore: number;
        evidenceCount: number;
    }>;
    warnings: string[];
    brands: BrandAttributionRow[];
}
