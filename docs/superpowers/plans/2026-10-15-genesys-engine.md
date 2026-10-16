# Genesys engine field zones implementation plan

**Goal:** Remove Extra Monster and Pendulum Zones in Genesys across existing engines, preserve replay rules, and publish the field layout.

**Architecture:** Keep the selected Master Rule and its other flags. Clear EMZONE, PZONE and SEPARATE_PZONE only when settings.genesys is enabled. Reuse the existing settings payload across host, worker and journal creation; include Genesys in replay source fingerprints. Publish optional field.genesys=true and suppress multiplayer sharedExtraWith when enabled. Off/absent settings retain existing payloads and flags.

**Tech stack:** TypeScript, ocgcore-wasm, existing installed WASM cores, Vitest real workers.

- [x] Add real-worker zone and summon regression tests for pinned/legacy normal/Domain 1v1 and normal/Domain Tag/FFA; verify they fail before implementation.
- [x] Mask zone flags in both engines; retain the multiplayer MR5 guard (zone removal introduces none of its prohibited old-rule flags).
- [x] Add optional shared view contract field; pass Genesys to both view projections and suppress facing-pair metadata when enabled.
- [x] Verify settings cloning through journal creation and include Genesys in replay fingerprints, preserving missing/null off compatibility.
- [x] Replay accepted placement commands through real workers and compare rebuilt fields and state digests.
- [x] Run only touched-area tests, shared build and duel-server typecheck. Document binary pin evidence and openIssues; commit on feat/genesys-engine with required trailer.
