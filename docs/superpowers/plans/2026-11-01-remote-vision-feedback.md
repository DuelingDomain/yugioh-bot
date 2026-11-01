# Remote vision feedback implementation plan

Goal: implement the owner's six-part recognition improvement loop in the isolated remote-vision-feedback worktree; push small commits, without PR/merge.

Architecture: opt-in authenticated corrections store only detected, warped card JPEGs and recognition metadata. Shared SQLite migration/service owns consent, bounded retention, moderation and deletion. A derived, deployment-wide delta snapshot includes admin-approved references or same-card, same-space embeddings confirmed by two distinct users (cosine >= .97). Rejection/deletion immediately withdraws evidence. Confusion pairs require independent users and cause extra hypotheses plus stricter certainty, never score boosts. Runtime snapshots are version/model/layout scoped and refreshed between recognitions. No new service or background inference.

Tech: Node 22, better-sqlite3, sharp, existing browser ONNX Worker, Next route handlers and existing admin console styles.

- [x] Extend existing pipeline tests and add one service integration test for consent/default-off/global-off, JPEG bounds, independent-user consensus, moderation, deletion, retention/count/byte caps and metrics. Run failures first.
- [x] Add shared migration and feedback service; normalized JPEGs (224px, <=32KiB), 30-day retention, 5,000 rows, 64MiB crops, bounded vectors/metadata, rate limits, crash-orphan cleanup; account deletion and worker scheduled cleanup. Commit after targeted checks.
- [x] Add opt-in recognition evidence and client recordFeedback; merge compatible delta references beside main/whole-card indexes; confusion pairs force extra views and stricter certainty. Add tests to existing pipeline/client files; typecheck and commit.
- [x] Add authenticated bounded feedback/preferences/deletion/delta APIs and owner review APIs, extend existing route tests. Default-off setting is asked once with clear explanation; account settings permit opt-out/delete even with collection disabled.
- [x] Add admin Vision view using existing section/loading/table/button patterns; list recent corrections and private crop previews, approve/reject/delete, confusion pairs, daily tier top-1/top-5 and sure-but-wrong numerator/denominator. Wire lab pick/search/AI confirmations and expose voice source through public client API. Keep existing local export.
- [x] Add offline approved export (trainer-compatible labelled crops + manifest) and actual-pipeline crop benchmark, before/after report and regression gate (same sample IDs, top-1/top-5 must not fall and sure-but-wrong must not increase). Exclude self/same-user learned references during evaluation; explicitly distinguish fixture numbers from real-player accuracy.
- [x] Update marketing privacy page (app links there), README/PORTING/report and env/runbook configuration. Run only affected integration/core/component suites, shared build and vision/web/worker typechecks; actual-model offline smoke using existing assets without downloads. Review diff, push branch, verify remote head and unchanged main checkout.

Authorization: the user supplied the design, scope and completion/push instructions. Execute inline without additional approval pauses. No new unit test files; integration tests allowed. Do not bind ports 3000/3417 or kill by process name. No attribution trailers.

Verification: 141 targeted cases pass; shared/worker builds and vision/web/worker typechecks pass. Real Chromium flow passes (one 13,898-byte upload, 0 page errors); actual-model five-crop before/after is 5/5 top-1/top-5, zero sure-but-wrong. See packages/vision/REPORT.md for scope and run commands.
