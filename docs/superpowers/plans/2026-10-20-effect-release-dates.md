# Effect release dates

Owner-approved scope: daily and manual additive release-month fills. Use one free
YGOPRODeck bulk endpoint, a 24-hour disk cache, three timed attempts and backoff.
An API failure leaves the tag candidate intact. Keep valid dates and all other
old record fields. Resolve artwork families before adding IDs. The existing
importer keeps engine pre-release remaps.

1. Extend the existing tagging HTTP integration suite for fills, cache/retry,
   failure isolation, and publication refusal. Add search ordering assertions.
2. Add the fetch/fill module and manual command. Wire the daily job and the
   existing candidate writer. Validate additive release changes at publication.
3. Run targeted integration suites and script type checks. Commit the code.
4. Run the real API fill once. Record counts and the ten newest fills. Commit
   only release data, manifest, and source pins.
5. Port commits to test/local-all. Wait for builds. Build shared, duel-server,
   then web with environment-file reads disabled. Copy standalone web to
   web-live, restart the two requested services, and verify health.

Do not push, read .env, modify duel-engine data, remove duel-server dist, or alter
preload. Each commit has the owner-requested attribution trailers.

Owner-approved addition: use the latest known region month for unqualified dates.
Include future months in “new cards”. Keep strict region searches. Use a known
set month only for undated engine pre-release cards; otherwise show Upcoming
and sort them first. Keep month, score and popularity tie order. Show Upcoming
and OCG marks. Record the real catalog's first 15 results before and after.
Implement and test this addition before the final local build and restart.
