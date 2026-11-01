# Recognition review fixes implementation plan

**Goal:** Implement Part 1 items 2, 4, vision-side 3 and webcam evaluation tooling, without retraining or changing the remote UI branch.

**Architecture:** Keep detector/warp/art embeddings. Filter physical catalog rows before search; search deck then catalog with clean-evidence guards. Learned crops only rerank clean top ten. Every evaluated frame must independently agree; the first clean sure frame may finish early at a .05 lead. Cache learning outside inference. Retain native frames and separate high-resolution AI crops from bounded feedback JPEGs. Export labelled realset images and raw decision evidence locally; offline threshold tuning maximizes sure coverage subject to zero observed wrong sure and a safety gap.

**Constraints:** Work only here on feat/remote-vision-feedback; retain existing next-env.d.ts changes; no server restarts, no paid API, no training, one small test file only, push small commits without attribution, no PR/merge. No physical webcam is available to the agent; do not invent realset results.

- [ ] Baseline: existing 30-photo synthetic browser WASM benchmark and six-frame latency; record counts/tiers/wrong sure.
- [ ] Search safety: add tests in one focused file for deck/off-deck fallback, catalog filtering and poisoned learning; implement physical policy, actual deck subset search and conservative learning rerank. Document runtime filtering and builder policy.
- [ ] Temporal safety: add tests in that file for disagreeing frames, moved selected quad, face-down and early exit; redetect every temporal frame and retain independent clean identities/guards. Capture AI warp at 640px from source, feedback at 224px separately.
- [ ] Integration: cache snapshot with version on a 60s background refresh; expose native own-feed ring and safe remote message serializer with tier/faceDown/covered and positive catalog IDs. Remote room transport does not exist in this branch; document adapter usage.
- [ ] Realset: add explicit lab capture mode with positive labels and non-card labels, frozen arbitrary point selection, local downloadable image+raw top-ten records, condition/card-width evidence. Add offline import/tune script, deterministic zero-wrong threshold search with safety gap and replay summary; bind settings to model/index/layout and load through profile/config.
- [ ] Verification: run the single focused test file, vision/web typechecks, worker bundle, repeat existing synthetic benchmark and mocked browser capture smoke. Review diff, document before/after counts and limits in REPORT.md/README.md.
- [ ] Delivery: commit small coherent changes; push branch; report paths, numbers and final commit SHA. Leave lab server running.
