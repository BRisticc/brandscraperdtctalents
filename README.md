# Agency & Operator Attribution

An [Apify](https://apify.com) actor that answers one question: **who actually runs this brand's ads?**

Give it a brand name. It generates a tiered set of Google dorks, runs them through a SERP actor, opens every result, follows the documents those pages link to, confirms the brand is really named in the body, and reads out the agencies, media buyers and creative strategists claiming the credit — each with a quote and a source URL you can check in one click.

```
brand name  →  dorks  →  SERP  →  open every hit  →  follow the documents they link
                                                              ↓
                              ranked operators, each with a quote and a source URL
```

Built for two jobs: **hiring** (find the people behind accounts you admire) and **competitive intelligence** (find out who is running your competitor's media).

---

## What comes out

```
Hazel Media                                              score 78 · agency
  found on   Google Docs · LinkedIn posts · Clutch
  roles      media buyer, creative strategist
  claims     4.2x ROAS, $180k/month in ad spend
  evidence   "…we took My Patriot Supply from $40k to $1.2M/mo on Meta…"
             https://docs.google.com/document/d/…  (Q3 media plan)
```

- **Dataset** — one row per brand, with the ranked operators and full evidence nested.
- **`REPORT.json`** — the same data plus the cross-brand operator leaderboard.
- **`REPORT.md`** / **`REPORT.html`** — a readable report. The HTML is self-contained.

`operatorLeaderboard` ranks operators by **how many of your brands they claim**. An agency that turns up against three brands in one niche is the most useful row this actor produces.

---

## The dork method

Attribution is a **search** problem before it is a scraping problem. `"My Patriot Supply" "case study"` mostly returns the brand's own site and press coverage. What works is multiplying four orthogonal axes and letting the engine do the joining:

| Axis | What it is | Example |
| --- | --- | --- |
| **Entity** | the brand, its aliases, its bare domain | `("My Patriot Supply" OR "Ready Hour")` |
| **Surface** | *where* practitioners publish | `site:docs.google.com`, `filetype:pptx` |
| **Claim** | the *language* of claiming credit | `("our clients" OR "clients include" OR "we scaled")` |
| **Role** | *who* claims it | `("media buyer" OR "creative strategist")` |

The full product of those axes is tens of thousands of queries — unaffordable and mostly noise — so queries are generated in **weighted tiers** and the cap is spread across them round-robin, so no single tier can eat the whole budget:

| Tier | What it reaches | Why it matters |
| --- | --- | --- |
| `core` | the open web: case studies, client rosters, results claims | finds most agencies on its own |
| `docs` | Google Docs/Drive/Slides/Sheets, open Drive folders, Canva, Notion, PDF/PPTX/DOCX/XLSX | work product, not marketing — the highest-evidence surface |
| `social` | LinkedIn profiles & posts, X, YouTube, Medium, Reddit | the claim, made out loud, with a name attached |
| `directories` | Clutch, Upwork, Contra, GoodFirms, Sortlist | the roster, already structured |
| `wide` | wildcards and proximity long tail | more cost, more noise; off by default |

Five things do the heavy lifting, and they are worth stealing even if you never run this actor:

1. **`AROUND(n)` beats plain AND.** `"brand" AROUND(12) ("roas" OR "cpa")` demands the brand and the claim be in the same breath. That is the difference between an agency's case study and a 4,000-word listicle that happens to contain both strings.
2. **`-site:theirbrand.com` on every query.** A brand's own pages will always outrank everyone else's for its own name. Excluding them is what makes room for the people who work *for* them.
3. **`after:2024-01-01` answers "who runs it *now*".** Without a date window you get whoever ran the account in 2019. The single highest-leverage operator for hiring and competitive work.
4. **The claim vocabulary is asymmetric on purpose.** It is the language practitioners use *about* a brand ("clients include", "we scaled", "prepared by"), never the language a brand uses about itself. That asymmetry does most of the filtering for free.
5. **Search for the artefact, not the advert.** `"brand" ("media plan" OR "creative brief" OR "ad account audit" OR "hook bank")` on `site:docs.google.com` finds the work itself. Nobody writes a media plan for an account they do not run.

And one that is not a dork at all: **search for the pages that link to documents, then read the links.** See below.

The full surface catalogue, claim vocabulary and 25 ready-to-paste sample queries are in [`docs/reference.md`](docs/reference.md), generated from the source by `npm run docs`.

---

## Open Google Drive, specifically

`site:drive.google.com` is a legal dork and this actor runs it, plus `site:drive.google.com inurl:folders` for open folder listings and `site:docs.google.com inurl:/d/e/` for published-to-web documents. Two things limit it, and neither is fixed by a better query:

1. **A Drive page renders in JavaScript.** Even when Google holds the URL, there is often little more than a filename to match a query against.
2. **Drive publishes no index of "anyone with the link" files.** A shared document is in Google's index only once *something crawlable has linked to it*. There is no way to enumerate the rest, by dorking or otherwise, and any tool claiming to is claiming something Google does not expose.

Point 2 is also the way in. The pages that link an agency's media plan are the pages the other tiers already find — its Notion wiki, a LinkedIn post, a newsletter, a "resources" page. So the actor runs **two passes**:

```
pass 1   dorks  →  pages that mention the brand           (incl. a dork for pages that
                                                           paste docs.google.com links)
pass 2   read the document links off those pages  →  open each one  →  same verification
```

Controlled by `maxHarvestedPages` (default 40, `0` disables). Links to Google Docs/Drive/Slides/Sheets, Canva, Notion, Dropbox, Airtable, Figma, Miro and SlideShare are followed by default; add your own with `extraDocumentHosts` (a company wiki, a Coda space). Google Forms, drawings and template galleries are skipped — not work product. Two links to the same document under different share tokens cost one fetch, not two.

A followed document clears exactly the same bar as a dork hit: opened, read, brand confirmed in the body. Every report line says which route found it (`via "<query>"` or `linked from <page>`), and `documentsHarvested` tells you how much the second pass contributed.

**Reading what you find.** A Google Doc URL that Google indexed renders its text in JavaScript, so a plain fetch returns an empty shell. The actor rewrites each one to its server-rendered projection before reading — `…/export?format=txt` for Docs, `…/htmlpresent` for Slides, `…/export?format=csv` for Sheets — which is the difference between *found a document* and *read the document*. Drive and Canva have no such endpoint, so those hits are reported with title and description only, and labelled as such.

---

## How a claim is scored

**Verification is not optional.** A SERP snippet is a claim about a page, not the page. Every surviving result is opened and the brand mention confirmed in the body; a hit that could not be read is **capped at 34/100**, so it can never outrank a page that was actually verified.

The surface sets the ceiling — an open media plan is worth more than a blog post whatever either says — and everything else moves the number inside it: result claims found near the brand, role words, how much of the claim vocabulary fired, and search rank (which decays gently, because dorks are already narrow).

**Corroboration beats volume.** Ten LinkedIn posts is one signal; a media plan plus a case study plus a Clutch roster is an answer. Claims gain up to 18 points for appearing across distinct surfaces and tiers, and lose 12 if nothing about them could be verified.

Who is named comes from two different jobs:

- **URL-shaped claimants** — LinkedIn, Upwork, Clutch, or an agency's own site. The identity is in the host and path, and is reliable.
- **Document-shaped claimants** — a Google Doc, a Canva deck, a PDF. The URL says nothing, so the identity comes from a contact email on a non-free domain, a "prepared by" line, or a domain in the footer. An email on the agency's own domain is the strongest single signal here: nobody puts hello@theiragency.com in a media plan they did not write.

Two readings of the same agency that the evidence does not actually join (a LinkedIn company page for one brand, its own domain for another) stay as two rows — deliberately. Collapsing them would assert an identity match nothing supports.

---

## Usage

### Input

`brandNames` is the only required field.

```json
{
  "brandNames": ["My Patriot Supply", "Nutrient Survival"],
  "extraBrandAliases": ["Ready Hour"],
  "dorkTiers": ["core", "docs", "social", "directories"],
  "dorkAfterDate": "2024-01-01",
  "maxDorkQueries": 40,
  "maxClaimPagesPerBrand": 60,
  "maxHarvestedPages": 40,
  "minClaimScore": 45,
  "proxyConfiguration": { "useApifyProxy": true }
}
```

More in [`examples/`](examples/) — a general run, an open-document sweep, and a tight high-confidence hiring shortlist. The full field list is in [`.actor/input_schema.json`](.actor/input_schema.json).

Each brand name is resolved to its own domain with **one plain query** (not a dork). That domain is not the goal — it is what goes into `-site:` so the brand's own marketing cannot answer for who runs its ads. Turn it off with `resolveBrandSites: false` if you are supplying `excludeDomains` yourself.

A proxy is strongly recommended: agency sites and document hosts both rate-limit datacentre IPs.

### Search provider

Google blocks datacentre IPs within a handful of advanced-operator queries — and `AROUND()`, `before:`/`after:` and `filetype:` are exactly the ones that trip the bot check soonest — so the dorks go through a SERP actor rather than a direct fetch.

| Provider | Needs | Notes |
| --- | --- | --- |
| `apify-actor` | Apify token (automatic on the platform) | Delegates to `apify/google-search-scraper` by default. Any actor taking a multi-line `queries` input and returning `organicResults` works — name it with `serpApifyActorId`. |
| `none` | — | Turns the run off. |
| `auto` (default) | — | Picks `apify-actor` if a token is present, else `none` — off rather than failing halfway through a run. |

**On cost:** dorks are batched 20 to a nested run, not one run per query, and brands are researched two at a time. `maxClaimPagesPerBrand` and `maxHarvestedPages` are the real cost controls — results are ranked before anything is opened.

### Running it locally

```bash
npm install
npm test                       # 137 tests, including an end-to-end run over local HTTP
APIFY_TOKEN=... npm start      # needs a token: the SERP actor runs on the platform
```

### Running it on the platform from your terminal

```bash
APIFY_TOKEN=... node scripts/run-remote.mjs --brand "My Patriot Supply"
APIFY_TOKEN=... node scripts/run-remote.mjs \
  --brand "My Patriot Supply, Nutrient Survival" \
  --aliases "Ready Hour" --tiers core,docs --after 2024-01-01 --hop 120

# See the input without running anything:
node scripts/run-remote.mjs --brand "My Patriot Supply" --dry-run
```

Flags: `--brand` (required, comma-separated), `--aliases`, `--tiers`, `--surfaces`, `--hosts`, `--exclude`, `--after`, `--before`, `--country`, `--language`, `--dorks`, `--results`, `--pages`, `--hop`, `--min_score`, `--concurrency`, `--no-resolve`, `--dry-run`.

---

## Troubleshooting

**No operators found for a brand.** Lower `minClaimScore`, add the `wide` tier, widen or drop `dorkAfterDate`. If `resultsSeen` is high but `operatorCount` is 0, the pages found were about the brand but named nobody resolvable — check `unattributed` in `REPORT.json`.

**`documentsHarvested` is 0 with a healthy `resultsSeen`.** The pages the dorks found do not link documents. Raise `maxClaimPagesPerBrand` so the second pass has more pages to read, or add the hosts your target actually uses via `extraDocumentHosts`.

**Everything comes back unverified.** Pages are loading but their bodies are not being read — usually a proxy problem. Check `proxyConfiguration`, and look at the `note` on each piece of evidence: it says exactly why a page could not be read.

**The SERP actor returned items but no results.** Its output shape differs from what is expected. Point `serpApifyActorId` at a different actor, or map its fields with `serpApifyActorInput`.

---

## Project layout

```
src/
  main.ts                  three-stage orchestrator
  input.ts                 input parsing, validation, provider resolution
  attribution/
    dorks.ts               the dork grammar: surfaces, claim vocabulary, tiered generation
    serp.ts                SERP provider interface + the Apify actor provider
    resolve.ts             brand name → its own domain, in one plain query
    verify.ts              open a page, confirm the brand, extract quote/metrics/roles, score
    readable.ts            URL rewrites that make Docs/Slides/Sheets readable to a plain GET
    link-harvest.ts        the second pass: document links read off the pages the dorks found
    claimants.ts           who is claiming credit, from a URL or from a document's own text
    attribution.ts         the pipeline and the ranking
  report/                  dataset rows, operator leaderboard, Markdown + HTML renderers
  util/                    domain, text, HTML, HTTP and proxy-session helpers
tests/                     137 tests including an end-to-end run over local HTTP
scripts/                   docs generator, and a one-command platform runner
```

## Legal

This actor searches the public search index, opens what it returns, and follows document links it finds on those pages. It does not authenticate, guess document ids, or try to reach anything that is not already reachable from a public page. Respect each site's terms and `robots.txt`, and keep concurrency civil.

Some of what it surfaces — an open Drive folder, a public Canva deck — is public by accident rather than by intent. Use it to identify *who does good work*, not to redistribute their clients' material.

## Licence

MIT. See [LICENSE](LICENSE).
