# Genesys points sync

`createCardCatalogService(db).syncGenesysPoints()` downloads the complete **TCG**
YGOPRODeck response from `format=genesys&misc=yes`. It validates before writing,
caches source cards and artworks, and atomically publishes points, their revision,
and `genesys_points_meta`. Ordinary catalog refreshes preserve points. A missing
points property means zero only in an accepted complete response; missing misc
data, invalid values, pagination, shrinking responses and unverified point changes
leave the last successful snapshot unchanged. Cards absent from an accepted new
snapshot become unknown (`NULL`).

The verified 2026-10-05 list contains 750 nonzero identities in a 14,615-card
response. Automatic sync verifies the entire nonzero name/points mapping against
its SHA-256, normalizing the two documented spelling differences. The revision is
`tcg-sha256-<hash>`; adding zero cards or artworks does not change the list revision.
Every publication rechecks current metadata inside its transaction to prevent a
late older response from replacing a newer list.

## Scheduling

On `test/local-all`, there is no production worker package. The Discord bot starts
the shared `createGenesysPointsSync` job after login, runs it immediately, and repeats
weekly. Its existing set sync, cleanup and sandbox jobs remain in place.
If the local deployment runs only web/duel and no bot, points do **not** refresh
automatically; run `createCardCatalogService(db).syncGenesysPoints()` manually
with `DATABASE_PATH` set to the shared application DB.

The source branch also wires this lifecycle into its production worker, including
shutdown draining, but that package is not part of this local port.

| Environment variable | Default |
| --- | --- |
| `GENESYS_SYNC_CRON` | `0 6 * * 0` (Sunday 06:00) |
| `GENESYS_SYNC_TIMEZONE` | `UTC` |
| `GENESYS_LIST_EFFECTIVE_DATE` | Verified list date, initially `2026-10-05` |
| `GENESYS_LIST_REVISION` | Bundled verified revision, or previously committed mapping |

The shared job coalesces overlapping ticks, reports failures, retries on the next
cron tick, and exposes `stop()` to drain work before database shutdown.

## Checking a list update

Use Node 22. The read-only checker compares every nonzero value against the copied
Konami name-to-points snapshot and prints spelling differences separately:

```sh
npx tsx packages/shared/src/maintenance/check-genesys-points.ts
```

For a saved full API response, add `--api-snapshot path/to/cardinfo.json`. To check
a newer official table, add `--official path/to/official-name-to-points.json`.
The exit code is nonzero for missing cards, unexpected pointed cards, different
points, malformed data or fetch failure. The two verified spellings are reported
and allowed; other unmatched names appear under missing/unexpected cards.

YGOPRODeck does not provide the official effective date. An unfamiliar mapping
therefore fails closed. After the checker succeeds against the new official table,
set **both** `GENESYS_LIST_EFFECTIVE_DATE` to that newer official date and
`GENESYS_LIST_REVISION` to the exact revision printed by the checker. This binds
the first import to the verified values, even if the source is damaged or lags
behind the announcement. Once published, the DB remembers that mapping/date;
further syncs accept it without those overrides. A different mapping at the same
or an older date is rejected. A legitimate reduction of the source card count
requires investigation and a deliberate adjustment of the completeness guard.

## Application DB reader for duel admission

The duel-server's `cards.ts` and `deck-legality.ts` load engine `cards.cdb`; that
file does not contain the application catalog's points. Both operate on
engine identity maps. The duel host supplies
a fresh active-revision points map from the application DB to `inspectDeck`,
including artwork identity bridging. Its column contract matches this sync. Card search and detail responses use that same map, including canonical artwork
points and unknown values. The shared reader also exposes a
reusable adapter without changing engine card types or engine data:

```ts
import { createGenesysPointsReader } from "@yugidraft/shared/services";
import { checkGenesysDeck } from "@yugidraft/shared/duels";

const points = createGenesysPointsReader(applicationDb);
const admissionCards = points.attach(engineIdentityCatalog);
const result = checkGenesysDeck(deck, admissionCards, settings.genesys);
```

`attach()` preserves engine names/types/aliases and normalizes artwork identities
with `canonicalCardCode`. For individual card responses, use
`points.points(codes, engineIdentityCatalog)` and attach each returned value.
`points.list()` exposes the current revision/date/provenance. All readers ignore
rows whose revision differs from active metadata. Reuse the reader across
requests, but attach points again for each admission/query so cron changes are
visible. The service tests exercise this adapter with the shared authoritative
Genesys admission helper, including unknown and stale points.

## Operational limits

An unfamiliar future points mapping needs a verified official date and exact revision
as described above. Earlier engine binaries cannot replay Genesys journals.
