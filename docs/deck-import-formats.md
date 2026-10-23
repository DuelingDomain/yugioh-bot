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

Engine-known IDs take priority and supported artwork remains intact. Explicit
database aliases supply canonical identity for duplicate and card-count checks;
the existing catalog/name resolver handles other known external IDs.

For the reported missing ID, an exact compatibility entry permits
`70828913 → 70828912` only when the target is a playable, alias-free engine row
named **Premature Burial**. This is the observed Dueling Book export exception,
not a general “subtract one” rule. An existing engine row for `70828913` wins.
Other unproven neighbors, including `70828914`, remain unresolved.

Every changed ID has a preview note naming the selected card, for example
“70828913 read as Premature Burial.” This avoids silently substituting a card
based on numerical proximity, including IDs from unrelated custom or prerelease
namespaces.
