# Release dates implementation plan

Goal: Add month precision release data, date readings, search controls, and cube era ranking to the approved effect search foundation.

Architecture: Add releases.json.gz to the existing hash checked artifact. Import canonical records into card_release. Use one date module for the reader, matcher, host scan, SQL insights, and era estimates. Keep all existing search filters.

1. Extend integration tests for the artifact, date queries, host scan, SQL ranking, and public request validation. Run the tests and confirm the missing behavior.
2. Add the release artifact builder, import table, identity folding, and remap support. Verify and commit.
3. Add date and stat readings, removable chips, date filters, and newest sorting in both search paths. Verify and commit.
4. Add optional cube era ranking and health warnings. Extend public request validation. Verify and commit.
5. Run shared, web, and duel-server type checks and targeted integration tests. Write the UI contract report. Remove generated build files. Commit the report and return the head SHA.

The task specifies integration tests only. Use the current integration files and real pinned data. No new unit tests are required.
