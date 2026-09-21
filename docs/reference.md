# Reference: the dork grammar

_Generated from the source by `npm run docs`. Do not edit by hand._

## Surfaces — 39 places practitioners leave fingerprints

Weight is "how strongly does a hit here mean this person ran the account", not "how likely is a hit". Extend the catalogue with the `extraDorkSurfaces` input.

### Tier `core`

| Surface | Operator | Weight | Readable without a browser |
| --- | --- | ---: | --- |
| Open web | `(none)` | 60 | yes |

### Tier `docs`

| Surface | Operator | Weight | Readable without a browser |
| --- | --- | ---: | --- |
| Open Drive folders | `site:drive.google.com inurl:folders` | 94 | via a URL rewrite |
| Google Docs | `site:docs.google.com` | 92 | via a URL rewrite |
| Google Drive | `site:drive.google.com` | 90 | via a URL rewrite |
| Google Slides | `site:docs.google.com inurl:presentation` | 90 | via a URL rewrite |
| Google Sheets | `site:docs.google.com inurl:spreadsheets` | 88 | via a URL rewrite |
| Published Google Docs | `site:docs.google.com inurl:/d/e/` | 86 | via a URL rewrite |
| PowerPoint decks | `filetype:pptx` | 84 | yes |
| Canva | `site:canva.com inurl:design` | 82 | via a URL rewrite |
| Word documents | `filetype:docx` | 80 | yes |
| Notion | `site:notion.site` | 78 | yes |
| Spreadsheets | `filetype:xlsx` | 76 | yes |
| PDF decks | `filetype:pdf` | 74 | yes |
| Notion (notion.so) | `site:notion.so` | 72 | yes |
| Dropbox | `site:dropbox.com` | 72 | yes |
| Pitch | `site:pitch.com` | 70 | yes |
| Airtable | `site:airtable.com` | 68 | yes |
| SlideShare | `site:slideshare.net` | 66 | yes |
| Figma | `site:figma.com` | 62 | yes |
| Miro | `site:miro.com` | 60 | yes |

### Tier `social`

| Surface | Operator | Weight | Readable without a browser |
| --- | --- | ---: | --- |
| LinkedIn profiles | `site:linkedin.com/in` | 88 | yes |
| LinkedIn posts | `site:linkedin.com/posts` | 82 | yes |
| LinkedIn companies | `site:linkedin.com/company` | 74 | yes |
| LinkedIn articles | `site:linkedin.com/pulse` | 70 | yes |
| X / Twitter | `(site:x.com OR site:twitter.com)` | 68 | yes |
| YouTube | `site:youtube.com` | 64 | yes |
| Medium | `site:medium.com` | 60 | yes |
| Substack | `site:substack.com` | 60 | yes |
| Reddit | `site:reddit.com` | 54 | yes |
| Threads | `site:threads.net` | 50 | yes |

### Tier `directories`

| Surface | Operator | Weight | Readable without a browser |
| --- | --- | ---: | --- |
| Clutch | `site:clutch.co` | 78 | yes |
| Upwork | `site:upwork.com` | 76 | yes |
| Contra | `site:contra.com` | 70 | yes |
| DesignRush | `site:designrush.com` | 64 | yes |
| GoodFirms | `site:goodfirms.co` | 62 | yes |
| Sortlist | `site:sortlist.com` | 60 | yes |
| Wellfound | `site:wellfound.com` | 58 | yes |
| Podcast episodes | `(site:podcasts.apple.com OR site:listennotes.com)` | 56 | yes |

### Reached by link, never dorked

Documents linked from a page the dorks already opened. Google indexes a Drive file only once something crawlable has linked it, so following those links reaches material no `site:` query reliably returns.

| Surface | Weight |
| --- | ---: |
| Linked document | 74 |

## Claim vocabulary

The language practitioners use *about* a brand, never the language a brand uses about itself. That asymmetry does most of the filtering for free.

| Intent | Phrases |
| --- | --- |
| `case-study` | `case study`, `client case study`, `how we scaled`, `how we took`, `results we got`, `before and after`, `the results`, `what we did` |
| `client-roster` | `our clients`, `clients include`, `trusted by`, `brands we work with`, `brands we've worked with`, `past clients`, `client roster`, `worked with`, `client list`, `partnered with` |
| `results` | `roas`, `return on ad spend`, `cpa`, `cost per acquisition`, `mer`, `aov`, `ad spend`, `scaled to`, `per month in ad spend`, `revenue`, `blended roas`, `7 figures`, `8 figures` |
| `role` | `media buyer`, `creative strategist`, `performance marketer`, `growth partner`, `paid social`, `paid media`, `growth marketer`, `ad buyer`, `facebook ads`, `meta ads`, `ugc creator`, `direct response` |
| `portfolio` | `portfolio`, `my work`, `brands i have worked with`, `brands i work with`, `worked on`, `resume`, `cv`, `about me` |
| `hiring` | `we are hiring`, `job description`, `now hiring`, `contract role`, `retainer`, `looking for a media buyer`, `freelance` |
| `internal-doc` | `creative brief`, `media plan`, `ad account audit`, `performance report`, `monthly report`, `hook bank`, `swipe file`, `scaling plan`, `testing plan`, `creative matrix`, `weekly report`, `account structure`, `launch plan` |
| `contract` | `statement of work`, `scope of work`, `proposal`, `invoice`, `retainer agreement`, `prepared for`, `prepared by`, `submitted to` |

## Sample queries

The 25 highest-weighted dorks generated for `My Patriot Supply` (alias `Ready Hour`, domain `mypatriotsupply.com`). Paste any of them straight into Google.

| # | Tier | Intent | Query |
| --- | --- | --- | --- |
| q1 | docs | internal-doc | `("My Patriot Supply" OR "Ready Hour") ("creative brief" OR "media plan" OR "ad account audit" OR "performance report" OR "monthly report" OR "hook bank" OR "swipe file") site:docs.google.com -site:mypatriotsupply.com` |
| q2 | docs | internal-doc | `("My Patriot Supply" OR "Ready Hour") ("creative brief" OR "media plan" OR "ad account audit" OR "performance report" OR "monthly report" OR "hook bank" OR "swipe file") site:drive.google.com -site:mypatriotsupply.com` |
| q3 | docs | internal-doc | `("My Patriot Supply" OR "Ready Hour") ("creative brief" OR "media plan" OR "ad account audit" OR "performance report" OR "monthly report" OR "hook bank" OR "swipe file") site:drive.google.com inurl:folders -site:mypatriotsupply.com` |
| q4 | docs | internal-doc | `("My Patriot Supply" OR "Ready Hour") ("creative brief" OR "media plan" OR "ad account audit" OR "performance report" OR "monthly report" OR "hook bank" OR "swipe file") site:docs.google.com inurl:presentation -site:mypatriotsupply.com` |
| q5 | docs | results | `("My Patriot Supply" OR "Ready Hour") ("roas" OR "return on ad spend" OR "cpa" OR "cost per acquisition" OR "mer" OR "aov" OR "ad spend" OR "scaled to") site:docs.google.com -site:mypatriotsupply.com` |
| q6 | social | role | `("My Patriot Supply" OR "Ready Hour") ("media buyer" OR "creative strategist" OR "performance marketer" OR "growth partner" OR "paid social" OR "paid media" OR "growth marketer") site:linkedin.com/in -site:mypatriotsupply.com` |
| q7 | social | client-roster | `("My Patriot Supply" OR "Ready Hour") ("our clients" OR "clients include" OR "trusted by" OR "brands we work with" OR "brands we've worked with" OR "past clients") site:linkedin.com/in -site:mypatriotsupply.com` |
| q8 | social | results | `("My Patriot Supply" OR "Ready Hour") ("roas" OR "return on ad spend" OR "cpa" OR "cost per acquisition" OR "mer" OR "aov" OR "ad spend" OR "scaled to") site:linkedin.com/posts -site:mypatriotsupply.com` |
| q9 | social | case-study | `("My Patriot Supply" OR "Ready Hour") ("case study" OR "client case study" OR "how we scaled" OR "how we took" OR "results we got" OR "before and after") site:linkedin.com/posts -site:mypatriotsupply.com` |
| q10 | directories | client-roster | `("My Patriot Supply" OR "Ready Hour") ("our clients" OR "clients include" OR "trusted by" OR "brands we work with" OR "brands we've worked with" OR "past clients") site:clutch.co -site:mypatriotsupply.com` |
| q11 | core | case-study | `("My Patriot Supply" OR "Ready Hour") ("case study" OR "client case study" OR "how we scaled" OR "how we took" OR "results we got" OR "before and after") -site:mypatriotsupply.com` |
| q12 | core | internal-doc | `("My Patriot Supply" OR "Ready Hour") AROUND(20) ("docs.google.com" OR "drive.google.com" OR "canva.com" OR "notion.site" OR "dropbox.com") -site:mypatriotsupply.com` |
| q13 | directories | client-roster | `("My Patriot Supply" OR "Ready Hour") ("our clients" OR "clients include" OR "trusted by" OR "brands we work with" OR "brands we've worked with" OR "past clients") site:upwork.com -site:mypatriotsupply.com` |
| q14 | social | role | `("My Patriot Supply" OR "Ready Hour") ("media buyer" OR "creative strategist" OR "performance marketer" OR "growth partner" OR "paid social" OR "paid media" OR "growth marketer") site:linkedin.com/company -site:mypatriotsupply.com` |
| q15 | core | client-roster | `("My Patriot Supply" OR "Ready Hour") ("our clients" OR "clients include" OR "trusted by" OR "brands we work with" OR "brands we've worked with" OR "past clients") -site:mypatriotsupply.com` |
| q16 | directories | case-study | `("My Patriot Supply" OR "Ready Hour") ("case study" OR "client case study" OR "how we scaled" OR "how we took" OR "results we got" OR "before and after") site:clutch.co -site:mypatriotsupply.com` |
| q17 | core | client-roster | `("My Patriot Supply" OR "Ready Hour") ("case study" OR "client" OR "roas" OR "we scaled") "mypatriotsupply.com" -site:mypatriotsupply.com` |
| q18 | directories | case-study | `("My Patriot Supply" OR "Ready Hour") ("case study" OR "client case study" OR "how we scaled" OR "how we took" OR "results we got" OR "before and after") site:upwork.com -site:mypatriotsupply.com` |
| q19 | core | results | `("My Patriot Supply" OR "Ready Hour") AROUND(12) ("roas" OR "return on ad spend" OR "cpa" OR "cost per acquisition" OR "mer" OR "aov" OR "ad spend" OR "scaled to") -site:mypatriotsupply.com` |
| q20 | directories | client-roster | `("My Patriot Supply" OR "Ready Hour") ("our clients" OR "clients include" OR "trusted by" OR "brands we work with" OR "brands we've worked with" OR "past clients") site:contra.com -site:mypatriotsupply.com` |
| q21 | core | role | `("My Patriot Supply" OR "Ready Hour") AROUND(15) ("media buyer" OR "creative strategist" OR "performance marketer" OR "growth partner" OR "paid social" OR "paid media" OR "growth marketer") -site:mypatriotsupply.com` |
| q22 | wide | results | `("My Patriot Supply" OR "Ready Hour") AROUND(20) ("scaled from" OR "took them from" OR "grew from" OR "went from") -site:mypatriotsupply.com` |
| q23 | wide | contract | `("My Patriot Supply" OR "Ready Hour") AROUND(8) ("prepared for" OR "prepared by" OR "in partnership with") -site:mypatriotsupply.com` |
| q24 | wide | role | `("My Patriot Supply" OR "Ready Hour") AROUND(20) ("agency of record" OR "growth agency" OR "creative agency" OR "media buying agency") -site:mypatriotsupply.com` |
| q25 | wide | portfolio | `("My Patriot Supply" OR "Ready Hour") AROUND(20) ("testimonial" OR "review" OR "loved working with") -site:mypatriotsupply.com` |

