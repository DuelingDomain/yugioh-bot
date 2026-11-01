# Remote solo test mode implementation plan

**Goal:** Run the complete remote duel loop with one webcam owner and 1–3 editable test opponents.

**Architecture:** Preserve the existing action bus and pure reducer. Persist `remote_tables.solo` and separate userless bot seats through an additive migration. Authenticate the owner once, then allow actions whose actor is the owner or one of that solo table's bots. Reducer field and turn ownership checks remain effective for the selected actor; event user identity always remains the owner.

**Scope:** The owner's requirements authorize implementation through push, with no PR. Work only in this worktree. Use Node 22, targeted tests, small commits without attribution, and remove generated build output.

1. Persistence and service (`schema.ts`, remote types/service, integration test).
   - Add failing coverage for 2/3/4 seats, userless bots, owner delegation, rejected outsiders, replay/idempotency, existing-data migration, and idle closure.
   - Add the flag, bot seat storage, serialized metadata, pre-ready bots, closed admission, and delegated actor validation.
   - Run the remote integration file and commit.
2. Routes and interactive page (`app/api/remote`, `components/remote`, command parser).
   - Test create validation, owner bot actions and local-only LiveKit responses through real routes.
   - Add create checkbox, seat panels, owner preview, editable twins/LP, selected voice actor, phase/turn controls, confirmed attack choices, log and undo.
   - Load OCR only on request; inspect the owner's local camera crop and resolve public card suggestions through the existing catalog endpoint. Never give bots cameras.
   - Run targeted route/parser/component tests and typechecks, then commit.
3. Contract and verification (`docs/remote-duels/contract.md`).
   - Document solo storage, authorization, actions, local media, recognition/voice limits and local instructions.
   - Review the final diff, run shared/web/ws checks and focused smoke checks, remove generated output, commit docs/fixes, push `feat/remote-duels`.

No changes to deployment activity queries: remote tables remain outside engine duel activity.
