# Store Remote Duel undo positions once

Approved scope: design B in data/briefs/remote-duels/action-data-measure-2026-11-06.md and the owner's production requirements.

- [x] Add one integration feature check in the existing remote service test: legacy upgrade, immutable history, atomic rollback, restart, replay facts and indexed lifecycle cleanup.
- [x] Add SHA-256 value storage and indexed state/event ownership in schema.ts. Preserve append-only events until their parent room is deleted. Keep ended rooms readable/undoable until explicit retention removes the room.
- [x] Add a versioned dual-read codec with a module-level LRU bounded by entries and bytes. Keep root metadata for existing SQL queries. Encode within existing immediate transactions, and collect only removed references.
- [x] Copy current positions and history metadata independently; freeze retained JSON values and use copy-on-write rule overlays.
- [x] Compare old/new via the same 1,000-action integration script using a fresh service for every call, with temp SQLite files. Compare every player/public/private/spectator JSON after every action, replay and mid-game legacy upgrade. Measure WAL frames, process writes, disk, memory and host load.
- [x] Run targeted service tests; typecheck shared, web, ws and worker. Review changes, remove build output, append measured results and commit without attribution or push.

No browser-computed-state or video work. Only this worktree is changed. Node 22 and prlimit --core=1:1 for heavy commands.
