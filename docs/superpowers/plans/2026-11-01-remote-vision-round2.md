# Remote vision round 2 implementation plan

**Goal:** Full-art hypotheses, optional owner-only AI reading, and an exact duel-lens inventory with useful missing interaction features ported.

**Architecture:** Preserve the standard artwork index and add an optional, separately validated whole-card index generated only from explicitly identified full-art references. Detect missing frame/text regions conservatively and compare standard and whole-card hypotheses without mixing their vectors. Return the selected warp for explicit/uncertain AI requests. Add a bounded server Messages client, catalog resolution, owner/env guards, and per-user limits. Freeze one image, detect all quads, hit-test them, and show a dismissible keyboard-accessible candidate popover.

**Constraints:** Only this worktree; Node 22; CPU; no port 3000; no real AI calls in tests; retain Apache notices; small commits without attribution trailers; push feature branch only. Existing next-env.d.ts change is excluded. Temporary upstream source is read before execution and removed after inventory.

- [ ] Audit upstream source modules and full-art image availability; document exact source-path status table in packages/vision/PORTING.md.
- [ ] Add full-art layout heuristic and independently keyed index builder, tests for both hypotheses and missing references, measured synthetic tests with honest limitations.
- [ ] Add owner-gated POST /api/remote-vision/ai with REMOTE_VISION_AI=1, ANTHROPIC_API_KEY, current repository Haiku model, small JPEG validation, four-second deadline, per-user rate limit, exact catalog matching. Mock HTTP in tests.
- [ ] Add client askAI API and lab Ask AI button, no image logging. Add freeze detection API, all-card gold outlines, quad selection and dismissible keyboard popover. Test meaningful interactions and stale-request cleanup.
- [ ] Rebundle worker, run vision tests/typechecks and relevant web tests/typecheck, exercise browser on an isolated port, review specification compliance then code quality, fix findings.
- [ ] Record counts, accuracy and limitations in durable report, remove temporary clone, commit in small units and push feat/remote-vision. No PR or merge.

AI server work and upstream audit can be delegated as isolated tasks; root owns vision runtime, builder, lab integration and final verification.
