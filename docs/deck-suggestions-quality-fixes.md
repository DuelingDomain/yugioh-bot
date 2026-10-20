# Deck suggestion quality fixes

The coordinator approved the ranking rules in the task. Apply the fixes on
`feat/deck-suggestions`. Make one commit for each fix. Do not push.

1. Extra: use a separate ranking step after the complete material check. Put
   native monsters and named deck materials first, then real profile matches.
   Keep at most three generic options at the end. Use physical copies. Exclude
   hand traps from the material profile. Extend the real-catalog eval first.
   Accept common printed recipe forms. Keep unknown procedures closed.
2. Archetype: use all engine setcodes. Put members and direct support before
   name-only links. Count distinct linked core cards. Use popularity and era
   within each group. Reject links to side engines alone. Keep Outside scoring.
3. Variants: keep the legal TCG identity. Remove non-TCG variants in Standard.
   Collapse recommendation families without changing copy-limit identities.
   Extend integration checks. Keep the fixed expected-card set.

Run the two shared integration files and the sourced four-deck eval. Run the
targeted host admission tests if admission changes. Build shared for consumers.
Save the full eval report and list every returned card for both scenarios.
Remove build output at the end. Do not read `.env` or write engine data.
