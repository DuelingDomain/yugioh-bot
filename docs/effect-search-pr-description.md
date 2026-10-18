# Fix effect search refresh, memory reporting and result stability

Catalog lookups no longer force the next cube preview to rebuild all effect
links on the web event loop. Seed preparation starts on the first preview in
one disposable process. Later catalog writes use the current snapshot while
one background refresh runs. Effect publications still require fresh tags and
release dates. Current artwork identities and cube exclusions apply at once.

When effect search is off, release filters and Newest first use a release-date
map. Describe keeps one era while it is open. A small owner-checked era route
reads the full cube and returns a structured newer-card count. The ATK reader
now handles lower and upper bounds, and does not read attack counts as stats.
The disabled newest-order button has a neutral mark.

Web memory remains a cost. A local production standalone HTTP test measured
**+130.7 MiB web RSS after a cold preview**, **+211.9 MiB after refresh**, and
**631.4 MiB peak RSS for web plus its helper**. A separate forced-GC test found
70.3 MiB of added live heap and buffers. These values are separate from the
earlier duel-server savings. The cold HTTP preview took 4.94 s; the first
preview after a catalog write took 200 ms.

Targeted shared, web and duel tests pass. The real-artifact eval passes all
69 queries, with no labeled false matches or missed matches. All 24 browser
cases passed across the four required sizes. Shared, web, duel and e2e
TypeScript checks pass. The production build and an isolated standalone
SQLite/child-process check pass. Full methods and limits are in
[the verification report](effect-search-performance-verification.md).

The production VM RSS check is still required before merge. SSH access to the
documented VM was denied. The local test does not replace that check.

No PR exists for this branch yet. This text is ready for that PR. Nothing was
pushed, merged or deployed.
