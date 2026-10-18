The compressed tag and archetype-profile data are copied verbatim from
LorenzoWhite/searchygo, commit 9b2d952f8e7c389e13267d4bba6504cc8ea4cb5c:
https://github.com/LorenzoWhite/searchygo

`tags.jsonl.gz` contains upstream `data/tags/tags.jsonl`;
`profiles.jsonl.gz` contains upstream `data/synergy/profiles.jsonl`.
`popularity.json.gz` contains only the `id` to `views` mapping extracted from
upstream `data/cards.json`, ordered numerically by card ID. The manifest includes
the SHA-256 of that original input as well as the derived mapping's hashes.
The original JSONL bytes are retained after decompression. The manifest records
the author, source commit, record counts and SHA-256 hashes of both compressed
and uncompressed content. These files contain AI-generated descriptions and
hand-written entries from the credited project. See the repository NOTICE for
the owner's permission context.

Compression uses Node 22 `gzipSync(bytes, { level: 9 })`, with no timestamp or
original filename in the gzip header. The combined compressed size is
3,541,961 bytes, so the artifact is tracked in Git and needs no runtime download.

`source-hashes.json.gz` maps every tagged passcode to SHA-256 of actual input
text in upstream `data/cards.json`. Normalization converts CRLF/CR to LF,
trims each field, and joins Pendulum text then monster text with one newline.
There are 13,693 known hashes and one null input (passcode 101402101). The
manifest pins this derived file and the original source-input SHA-256.

`releases.json.gz` contains first TCG and OCG release months from the same
upstream `data/cards.json` (YGOPRODeck misc data). It also retains source names
and artwork aliases for canonical passcode resolution. Dates before 2002 in the
TCG and before 1999 in the OCG are removed as placeholders. No first-set data
is added to this snapshot. These source dates can refer to a later print.
The month precision avoids a claim of exact day accuracy. Future months are
retained; readers calculate the Upcoming state at use time. Rebuild with Node
22 and `tsx scripts/effects/build-releases.ts <source-cards.json>` from the root.
Keep the credit: Release dates from YGOPRODeck via searchygo.
