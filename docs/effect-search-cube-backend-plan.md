# Effect search cube backend plan

The owner approved the feature scope and foundation contract. This work uses the
existing SQLite services and authenticated web routes. No new unit tests or UI
changes are required for this backend slice.

- [x] Add transactional `addBatch` with per-row copies, engine section routing,
  canonical duplicate reporting, and no change to existing copy totals.
  Cover it with a real SQLite integration suite before implementation.
- [x] Add a read-only phrase seed preview: select core phrase/archetype matches,
  rank partners with the existing synergy scorer and profiles, fill role quotas,
  and report shortages. Exclude cards already in the cube. Confirmation uses
  `addBatch` with the chosen rows. Add authenticated route integration coverage.
- [x] Extend `/api/cards/resolve` with an explicit effect description mode. Keep
  all name-resolution branches on their current path.
- [x] Add optional `poolHealth` to cube analysis and per-cube draft preflight.
  Health runs only when requested by preflight; observations stay in the health
  field. Existing supply warnings, errors and access rules stay.
- [x] Build shared before consumers. Run targeted integration and affected
  regression files with one worker, then shared/web TypeScript checks.
- [x] Review the changes, publish the UI contract, make small local commits,
  and remove generated build outputs. Do not push.

Seed target means new distinct card rows, not copies or final cube size. Requests
are bounded to 500 seed rows, 1,000 batch rows and 512 phrase characters. Batch
duplicates are skipped; first occurrence wins. Both preview and confirmation
use the existing feature flag and attribution. Confirmation rechecks ownership
and duplicates, so a changed cube can safely accept a prior preview selection.
