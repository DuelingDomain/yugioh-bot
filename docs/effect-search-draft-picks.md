# Smart draft picks

Implement the approved phase 3 plan on the effect-search foundation.

1. Add SQLite integration coverage for a fixed-seed eight-seat draft and a
   random-policy draft with the same deal. Compare every seat's mechanical links.
2. Add one shared scorer for popularity, `pickScore`, Main/Extra balance and
   material supply. Keep seeded variation small and stable across service restarts.
   Use only legal options, retaining copy caps, forced picks and theme phases.
3. Use that scorer in the web bot loop and timeout expiry. Add private,
   flag-controlled fit reasons to the current human pack in draft responses.
4. Run targeted integration/regression checks, consumer type checks and the four
   required browser viewports. Keep all work and commits in this worktree.

The API extension and final verification results will be recorded here. This
task supplies the draft UI contract; it does not change draft-room presentation.
