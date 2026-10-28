# Archetype bridge engine measurements

Measured locally on 2026-10-28 with Node 22.23.3 and algorithm `capability-bridges-v5`. Graph version: `a22a0a568e4dcc7e2397260d85c68693fe5dad5f4ff695293af4a815b3f8f07a`. See [the API contract](../api/archetype-bridges.md) and [the judging runbook](../runbooks/bridge-judging.md).

## Round 3 verification

Six general rules now govern named reach membership, discard-engine density, source API evidence, same-deck naming families, primary-card twins in top-four results, and completed-search cache reuse. Named/archetype outlets are exempt from stat fan-out suppression. Discard outlets require at least 0.2 of source Main Deck cards and discard triggers on at least one-third of target monsters. Curated groups are exempt from source API evidence.

Top-four results retain one row per primary source Main Deck evidence card. Broader candidate scans retain alternatives for direct pair lookups and judging. Pending judgements retry after ten minutes; permanent reviews retain the 24-hour cache. Evidence validation happens before the admission write transaction.

Rebuild inputs match the preceding artifact: the prepared engine database and cached API metadata were read without modification. The rebuild indexed 13,954 cards across 458 groups in 73676 ms, with peak RSS 725928 KiB.

| Format | Rows before | Rows after | Top-four rows after | Golden precision@5 | Golden recall@10 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Advanced | 457 | 303 | 226 | 100% | 19/30 (63.33%) |
| Genesys | 428 | 273 | 198 | 100% | 18/28 (64.29%) |


The strict evaluator passed `--check --strict-precision`, with 100% judgement coverage and no known false bridges in the golden set. Golden rows were not relabelled. Recall totals are unchanged from round 2: restored positives are offset by same-deck merges. The report measures the existing labelled core sources; it is not an independent precision estimate for all 576 rows.

Restored golden positives: Danger! → Dark World in both formats and Diabell → Snake-Eye in Advanced. New recall losses: Sangen → Tenpai Dragon in both formats and Live☆Twin → Evil★Twin in Advanced, following same-deck merging.

The remaining golden positives outside the top ten in both formats are Tenyi → Swordsoul, Sangen → Tenpai Dragon, Invoked → Shaddoll, Odion → Altergeist, Fiendsmith → Danger!/Dark World, and Branded → Dogmatika/Danger!/Fabled/Dark World. Advanced additionally misses Live☆Twin → Evil★Twin.

## Hubs in top-four results

The count is the number of source groups whose top four contain that target. Ties use target name.

| Format | Target | Sources | Count |
| --- | --- | --- | ---: |
| Advanced | Dark World | Danger!, Firewall, Purrely, Sangen | 4 |
| Advanced | Dogmatika | Bystial, Despia, Possessed, Springans | 4 |
| Advanced | Nouvelles | Black Luster Soldier, Impcantation, Prediction Princess, Vendread | 4 |
| Advanced | Synchron | Junk, Noble Knight, Scrap, Stardust | 4 |
| Advanced | Archfiend | Assault Mode, Earthbound, Resonator | 3 |
| Genesys | Danger! | Clown Crew, Dark World, Predap, Purrely, Sangen, WAKE CUP! | 6 |
| Genesys | Dogmatika | Bystial, Despia, Possessed, Springans | 4 |
| Genesys | Nouvelles | Black Luster Soldier, Impcantation, Prediction Princess, Vendread | 4 |
| Genesys | Synchron | Junk, Noble Knight, Scrap, Stardust | 4 |
| Genesys | Archfiend | Assault Mode, Earthbound, Resonator | 3 |


The preceding top hub was Toon, with eight source groups in each format. It no longer appears in the five leading targets. All 422 non-curated top-four rows have at least one evidence card whose API archetype matches the source or an alias. Two Odion rows, one per format, use the curated exemption.

## Requested CLI top fours

Results come from `scripts/effects/bridges.ts` with `--limit 4`, using a disposable database imported from the rebuilt artifacts. Entries are ranked left to right; fewer than four means no further retained row qualifies.

| Source | Advanced | Genesys |
| --- | --- | --- |
| Odion | Ashtra | Ashtra |
| Blue-Eyes | Millennium; Black Luster Soldier | Millennium; Black Luster Soldier |
| Fiendsmith | Fabled | Fabled |
| Snake-Eye | Fire King; Diabell | Fire King; Diabell |
| Branded | Despia; Bystial | Despia; Bystial |
| Swordsoul | Tenyi | Tenyi |
| Kashtira | Tearlaments; Scareclaw | Tearlaments; Scareclaw |
| Diabell | White Forest; Snake-Eye | White Forest; Snake-Eye |
| Azamina | White Forest; Sinful Spoils | White Forest; Sinful Spoils |
| Zefra | Yang Zing | — |
| Danger! | Dark World | Dark World |
| Fluffal | — | — |
| Anti | — | — |
| Cyber Dragon | Cyberdark; Photon | Cyberdark; Photon |
| Junk | Synchron; Scrap; Morphtronic | Synchron; Scrap; Morphtronic |


Named Diabell/Azamina/Snake-Eye connections and Advanced Zefra → Yang Zing/Nekroz/Ritual Beast also remain available as direct pair lookups. Repeated primary source cards can keep some of those pairs out of the top four. Genesys bars Zefra’s Pendulum entry cards.

## Tests and remaining limits

All 55 tests passed across the targeted shared bridge pipeline, round 3 catalog regressions, bridge judge, search-job lifecycle, authenticated API, worker isolation, evaluator, and artifact-integrity integration files. Shared and duel-server TypeScript builds passed. No unit tests were added and no full package suite ran.

Selecting a different reason solely to recover source API evidence can revive the explicitly rejected Cyberdark → Cyber row. The guard therefore validates the selected evidence, preserving the requested rejection; some otherwise usable alternative lines are conservatively pruned.

Toy does not meet the numerical same-deck naming thresholds against Fluffal, Frightfur, or Edge Imp. Its false Fluffal lookup is suppressed by engine membership checks rather than an actual family merge.

The literal membership and source API rules do not ban every appearance of a named card: Chaos → Galaxy still uses Tachyon Chaos Hole, and Dark Contract → Supreme King can use D/D/D Supreme King Kaiser through its printed D/D identity. The wrong-label target reaches covered by the new membership checks are rejected. Eliminating those additional directions requires a further general rule.

Stored rows remain deterministic candidates. Player-facing publication requires both independent judgements and feedback/format checks; no engine execution or external judging was performed for this round.
