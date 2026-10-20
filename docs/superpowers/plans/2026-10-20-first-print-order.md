# First-print order correction

Owner rules: use each region's earliest known first print; unknown months must
not be Upcoming or lead date searches; restrict date searches to TCG/OCG cards.
The existing engine pre-release set number supplies month tie order, then
popularity. Do not use cached_at: it changes on refresh.

1. Extend the existing HTTP integration test. Read bulk card sets and misc_info.
   Retain earlier known months, correct later stored months, and report dates
   later than first set appearance. Permit only evidenced earlier corrections
   in publication. Preserve identities and unrelated artifact data. Commit.
2. Extend the existing engine/search integration test. Correct unknown marks,
   region selection, set fallback, set-number ties, and official-pool filters in
   engine and SQL search. Verify only affected tests and commit.
3. Apply the free data correction. Check counts and repeat stability. Commit.
4. Port each change to test/local-all. Keep optimized SQL readers. Wait for other
   builds. Build shared, duel-server, web; keep duel-server dist and preload.
   Copy standalone web to web-live with rsync. Restart the two named services.
   Read all authenticated new-cards pages and report the first 25 and counts.
5. Update the verification record and commit. Do not push.

Limits: Node 22.23.3; prlimit --core=0; no environment-file reads; no writes to
any data/duel-engine* path; kill only by PID; no stash or hard reset. All commits
include the owner's co-author and session trailers.

Evidence: API misc_info and local catalog identify Diabellstar, the Seeker of
Sinful Spoils (100461000) separately from Diabellstar the Black Witch (72270339).
The Seeker has no set entries and its sole known OCG date is 2027-03-01. Do not
invent an earlier print or discard a verified future first-print month.
