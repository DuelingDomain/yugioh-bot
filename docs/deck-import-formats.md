# Simulator deck imports

Bulk library import accepts numeric YDK, one `ydke://` code per line, and card-name
lists pasted or uploaded as text (including `.txt`). Name lists use the same parser
and resolver as single-deck and cube imports. Counts such as `3x Dark Hole`,
`3 Dark Hole`, and `Dark Hole x3`, Main/Extra/Side headings, and Monster/Spell/Trap
category headings are supported. Unknown names block their row and show the
original input and source line. Known cards retain copies and section order.

The existing section rules apply: Extra monsters listed in Main move to Extra;
explicit Side cards stay in Side. In Domain, a lone Side card becomes Deck Master.
Numeric YDK files retain their existing bad-passcode warnings.

## Export formats and identifiers researched

| Source | Portable export and ID behavior |
| --- | --- |
| Dueling Book | Its [exporter](https://static.duelingbook.com/utils.js) (`exportDeckYDK` / `exportDeckYDKE`, inspected 2026-10-23) writes `alt_passcode` when present, otherwise `serial_number`. Its internal card IDs are separate. |
| EDOPro / YGOPro derivatives | [Project Ignis](https://github.com/ProjectIgnis/BabelCDB#guidelines-for-passcodes) uses official passcodes for released cards, nine-digit prerelease ranges, and explicit aliases for artwork. Numerical proximity alone does not establish an alias. Existing verified bundle remaps handle graduated prerelease IDs. |
| YGO Omega | Its [official deck editor](https://next.duelistsunite.org/deck-editor) offers portable YDK and YDKE exports alongside its own deck code. Use YDK/YDKE here; the proprietary Omega code is a separate format. |
| Dueling Nexus | Its [official documentation](https://duelingnexus.com/blog/dueling-nexus-partner-program-faq/) describes interoperability with YGOPro-derived YDK files. No authoritative general alternate-ID conversion rule was found; portable passcodes and names use the normal resolver. |
| Master Duel / Neuron exporters | The [Deck Transfer exporter](https://github.com/DawnbrandBots/deck-transfer-for-master-duel/blob/master/src/yugioh-card.js) translates Konami database IDs through YGOPRODeck's `konami_id` metadata into passcodes before producing YDK/YDKE. Raw Konami IDs are not interchangeable with passcodes. Name lists also work. |

## Alternate artwork policy

Playable engine IDs take priority and supported artwork remains intact. Explicit
database aliases supply canonical identity for duplicate and card-count checks;
the existing catalog/name resolver handles other known external IDs.

Dueling Book's public [card data](https://static.duelingbook.com/cards.json) supplies
an explicit compatibility table in
`packages/duel-server/duelingbook-alt-passcodes.json`. Its `cards` array uses `n`,
`s`, and `s2`, which `loadCards` in the exporter expands into `name`,
`serial_number`, and `alt_passcode`. Both that object and a bare card array are
accepted by the refresh script; full field names are also supported. No login,
session, or private endpoint is used.

Refresh locally after preparing the pinned engine data with Node 22:

```sh
node --import tsx packages/duel-server/scripts/update-duelingbook-passcodes.ts
# An alternate prepared bundle can be selected with --data-dir or DUEL_DATA_DIR.
```

The script makes one GET with a 30-second timeout and no retries. A mapping is
kept only if its source ID is absent from the engine or belongs to an unplayable
row with a different name, its target is a playable, alias-free engine row, and
the Dueling Book and target engine names match after Unicode
normalization, case folding, and removal of accents, spacing and punctuation.
It reports skipped counts and up to five examples per reason, excludes conflicting
targets for the same alternate ID, and writes deterministic JSON. A companion
`duelingbook-alt-passcode-names.json` records engine names so imports recheck the
target name and playability even when using an older prepared bundle.

The reviewed refresh (2026-10-23) found **292 alternate rows** among **18,535 cards**:
**80 mappings**, **209 engine-known IDs preserved**, and **3 missing targets**.
There were **0 name mismatches**, unplayable targets, invalid passcodes or
ambiguous alternates. Preserved IDs include `41356846` (Acid Trap Hole) and
`70095155` (Cyber Dragon). Missing targets are Dueling Book's anime IDs
`10000023` (Slifer the Sky Dragon), `10000003` (Obelisk the Tormentor), and
`10000013` (The Winged Dragon of Ra). These are skipped rather than guessed.

Verified examples include `70828913 → 70828912` (**Premature Burial**),
`81480461 → 81480460` (**Barrel Dragon**), and `10000050 → 1784686`
(**The Eye of Timaeus**). This uses explicit export data, never a “subtract one”
rule. Unproven neighbors, including `70828914`, remain unresolved. If an engine
update introduces a playable row at any mapped source ID, that engine row wins
immediately. Verified mappings override token collisions: `27204312 → 27204311`
(**Nibiru, the Primal Being**) and `53855410 → 53855409` (**Doppelwarrior**).

The **Engine data update** workflow refreshes these files every Monday and
Thursday at 06:00 UTC, after preparing the candidate engine database. It also
supports table-only changes when Ignis pins stay unchanged. An unavailable,
malformed, or alternate-free feed retains the committed files and does not fail
the engine-data update. The scheduled PR report includes refresh counts; the
full examples are in its `duelingbook.json` artifact and job log. The publication
allowlist admits only the two generated JSON paths alongside the existing pin
paths, validating the JSON and file modes before writing anything.

Every changed ID has a preview note naming the selected card, for example
“70828913 read as Premature Burial.” This avoids silently substituting a card
based on numerical proximity, including IDs from unrelated custom or prerelease
namespaces.
