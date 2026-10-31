# Bridge approach signals implementation plan

**Goal:** Implement the owner's approved co-play prior, effect-grounded mechanic synergy and sampled engine cores without publishing unjudged pairs or writing the live database.

**Architecture:** Keep tournament statistics in a small derived artifact, independent of the bridge graph. Add focused modules for pair priors, deterministic mechanic profiles and observed copy adjustments; connect them through small scanner/ranking/core hooks. Use the existing synergy lane and both independent Haiku reviews.

**Constraints:** Existing worktree and branch; explicit-path commits; integration tests only; no type/attribute-only rule, live DB writes, environment-file reads or duel-engine changes. Preserve other agents' edits.

- [x] Capture four-deck baseline from a read-only live backup, with accepted Next engine results and raw review shortlists distinguished.
- [x] Increase the tournament sample to 1,000 per format with a one-second request interval, bounded retries, source hashes and de-duplication. Commit derived pair counts/share/lift and archetype member copy statistics, excluding raw lists.
- [x] Derive deterministic legal member profiles from searchygo tags plus checked printed mechanics; nominate complementary mechanics with named cards and evidence. Preserve synergy limits, zero access coverage and both judge gates.
- [x] Reserve a bounded review lane for co-play pairs with real reasons, and apply a bounded ranking boost to accepted Next engine rows.
- [x] Adjust grounded core quantities from observed Main/Extra copies when at least five lists support an engine, retaining dependency gaps and format/Genesys/Domain projections.
- [x] Add and run integration coverage for fetched artifacts, real catalog mechanic evidence, judge gating, ranking and core legality. Run shared/server typechecks.
- [x] Re-run the same four-deck projection, record evidence and limitations, review changes, delete scratch/build output, and commit only owned paths.
