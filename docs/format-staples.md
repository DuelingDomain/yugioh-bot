# Measured format staples

Suggestions and the plain queries `staples`, `format staples`, `best staples` and
`hand traps` share a versioned usage table. Exact card names still use name
search. Qualified effect queries such as `hand traps that negate` keep their
effect filters. `hand trap` also keeps the broad effect-role search.

The deck editor and draft browser send Normal, Domain, Genesys or Genesys
Domain with the card query. No context defaults to TCG. Normal with an OCG
banlist has no measured sample and uses the previous role/popularity fallback.
Genesys Domain also falls back until an independent source meets the gate.
No TCG sample is substituted for Domain or Genesys Domain.

## Public data

The source is the YGOPRODeck deck API used by the site's category browser:

- [TCG tournament lists](https://ygoprodeck.com/category/format/tournament%20meta%20decks)
- [Domain community lists](https://ygoprodeck.com/category/format/domain%20format%20decks)
- [Genesys community lists](https://ygoprodeck.com/category/format/genesys%20decks)

The refresh reads at most four pages of 20 decks per source. It excludes
resource/staple collections, incomplete lists and unknown card IDs. It combines
artworks by the card API identity, then removes identical deck lists. Main,
Extra and Side all count. A card's play share is the number of distinct decks
that include it divided by the number of accepted decks. Mean copies is copies
per deck **that runs the card**. Each deck's primary archetype is the largest
non-generic archetype group in Main, using API metadata.

A sample requires 20 decks. A staple requires 10% share, use in at least three
primary archetypes, and no primary archetype above 60% of its appearances.
The generic-card gate rejects effect tags with archetype support, named-card dependencies, and printed
requirements for named cards/archetypes. Archetype membership alone is allowed:
Ghost Girls can still be staples. These are explicit, conservative heuristics.

`packages/shared/data/staples/usage.json` holds counts, copies, archetype counts,
source URLs, response SHA-256 values and a content version. `decks.json` holds
only the public source URL, inferred archetype and card arrays. No source user
IDs are stored. These are bounded recent samples, not all decks played in a
format. Community uploads do not prove tournament strength or legal decks.
The existing application legality and pool filters still decide admission.

The initial 2026-10-20 sample has 79 TCG decks / 19 archetypes, 75 Domain decks /
59 archetypes and 80 Genesys decks / 60 archetypes. Inspect the artifact for
exact percentages and average copies.

## Saved-deck source

The server can use saved decks once a guild format has at least 10 owners and 20 distinct complete
lists and cards pass the same share/archetype gates. It reads `mode`,
`genesys_json` and `deck_json`, plus cached card metadata. Owner IDs stay in memory for vote deduplication; none are published. Only the latest complete deck per owner and format votes. Cards need at least three owners; each reported archetype count also needs three owners.
Only aggregate card counts survive the scan. A qualifying private cohort takes
precedence over the public sample for that format; it is never published by CI.
Small cohorts are ignored. The scan is bounded at 10,000 lists and cached by
a saved-deck revision and the catalog/effect revisions. Same-second edits
invalidate the aggregate. Duel and analytics writes do not invalidate it. Normal saved decks are classified as TCG
because saved decks do not store a region. No private data is sent to GitHub.

## Refresh and safety

The existing effect-tagging workflow runs the independent staples job daily.
It needs no paid model key. Fetches have 20-second timeouts, response limits and
a three-minute overall deadline. Output files have a 500 KB publication limit.
Both publication and the runtime reader validate schema, counts and versions.
A failed format retains its previous sample. Failed complete refreshes publish
nothing. Evidence for retained formats is preserved.

Publication permits only the two data files. It checks the trusted base SHA,
uses a new branch for each candidate, and never overwrites an existing branch.
It opens an artifact PR and dispatches checks. It never merges the PR. Code,
effect tags and engine data are outside its write set.

Reproduce with Node 22:

```bash
prlimit --core=0 node scripts/staples/refresh.mjs
STAPLES_BASE_SHA=$(git rev-parse HEAD) prlimit --core=0 node scripts/staples/publish.mjs --validate-only
```

Run the targeted search integration suite and the sourced-deck evaluation in
[the quality guide](deck-suggestions-quality.md). Live proof is recorded below
after publication to the local verification service.

## Source verification (2026-10-20)

- 176 targeted integration checks pass across the shared real-catalog evaluator,
  duel search, signed suggestion host and worker transport.
- Normal Branded Staples include Ash Blossom and Infinite Impermanence. Domain
  Staples include Graceful Charity, Raigeki and Infinite Impermanence. Every row
  has measured reasons and descending play share. Existing legality checks pass.
- Plain staple queries include Ash Blossom and Infinite Impermanence. Domain
  and Genesys queries select their own tables. Exact names, literal mode,
  name-only mode, pool limits and kind filters remain covered.
- A 19-list private cohort is ignored. At 20 it activates. Same-second deck
  edits invalidate it, while name-only changes do not.
- Artifact validation accepts the real sample and rejects six malformed
  candidates, including duplicate IDs, false percentages and extra fields.
- Shared/duel builds and web typecheck pass. No new unit tests were added.

## Live verification on port 3000

Published on 2026-10-20 with the documented stop/copy/start rule. The web gap
was 0.79 seconds. Both services are active. Runtime sandbox settings and the
shared database/engine paths match. The no-env-file guard and core limits stay
active. No engine data was written.

Authenticated web requests match signed host results for all three formats:
TCG returns 16 cards (Ash Blossom first), Domain returns 24 admitted cards
(Graceful Charity first), and Genesys returns 11 cards (Lava Golem first).
The artifact has 25 Domain candidates; the running engine admits 24. Plain
`format staples`, `best staples` and `hand traps` also pass. Exact-name
`Morphtronic Staplen` remains a name result.

Chromium checks pass at 1920×1080 and 390×844. Both show Ash Blossom and Infinite
Impermanence, the measured reason lines, and no Morphtronic result for
`staples`. Exact text is off and there are no page errors. Desktop also imports
real source decks through the UI and shows the Normal and Domain Staples rows.
The Normal test deck holds Called by the Grave and Triple Tactics Talent, so
Infinite Impermanence fits inside the six-card Staples limit. The Domain test
uses its default no-banlist scope.

Local evidence: `local-all/.status/format-staples/` contains the proof script,
results JSON and four screenshots. These files contain no cookies, secrets or
user identifiers. The source checkout passed 176 targeted integration checks;
the newer local-all checkout passed 178 with its live engine bundle. The final
production build and standalone packaging passed. Temporary build/staging
output was removed after publication; installed service files remain in use.
