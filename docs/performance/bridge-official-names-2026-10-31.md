# Official bridge group names

Renamed display group: **Odion → Temple of the Kings**. The other groups retain their existing archetype or key-card names.

`Odion` remains an internal stable identity in graph membership keys, directed evidence, existing judgements, job query keys and saved chip values. `bridge-groups.json` and the integrity-pinned manifest now give that identity the explicit `display_name: "Temple of the Kings"`. Artifact row contents, card membership, scores and evidence hashes are unchanged; the manifest is repinned for the display metadata.

Host requests accept both the official label and the historical identity, ignoring case and surrounding whitespace. All host response values, including detection, selected chips, between rows, next-engine links, core captions, admin feedback and public conflict messages, use the official name. Translation occurs after normal evidence/review validation, so existing cached judgements remain valid and require no model calls. The archetype-name endpoint also lists the official name. No live database migration or artifact import was performed.

The catalog/API integration case checks both aliases, accepted output, deck detection, unchanged input hashes and stored reviews, and zero new paid/candidate calls.
