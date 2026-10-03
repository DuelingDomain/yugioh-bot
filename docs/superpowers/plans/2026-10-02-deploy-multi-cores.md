# Deploy both multiplayer cores

The deploy uses the existing pinned CI build, without changing engine rules or patches. Both Standard and Domain multiplayer WASMs travel in the engine bundle with checksums and build provenance. A bundled duel image carries the same bundle; its startup installer fills the mounted data directory. Compilation stays on the CI runner.

- [x] Extend installer tests for Domain checksums, updates under an identical manifest, preflight and active multiplayer duels; reproduce the missing update.
- [x] Extend the shared installer to validate and install both optional multiplayer cores. Require both in the staging wrapper.
- [x] Build and package both deploy cores from `domain-core/pins.json`, all numbered patches and the Domain layer. Cache both artifacts and build metadata, hashing every relevant input.
- [x] Use that build in staging and production workflows. Record the checked-out commit, not the workflow dispatch commit.
- [x] Add a bundled duel image target and prepare its build context from the transferred bundle on the VM. Keep the existing bare target available for development.
- [x] Build locally, inspect the baked runtime directory, test startup with a fresh bind mount, and run availability guards and real 3/4-seat engine smoke tests.
- [x] Update the staging runbook, review the diff, commit in small units with the requested trailers, and remove created output and test images. Do not deploy or push.
