# Multiplayer opponent choice implementation plan

**Goal:** Apply the owner 2026-10-18 decision and allow only cards with live engine proof.

**Architecture:** Use the existing multiplayer Lua overlay and opponent binding helpers. Keep engine data read-only. Keep 1v1 scripts unchanged. Change the host only if a script cannot apply the rule.

**Validation:** Use live scenarios, the existing catalog checks, and TypeScript checks. Use Node 22 and one Vitest worker. Do not add unit tests.

- [x] Install dependencies and copy the patched engine wrapper.
- [x] Read the current rule list, script helpers, and scenario tools.
- [ ] Add live scenarios for Angelechy Opposition and Nibiru. Apply each rule in its own overlay.
- [ ] Add live scenarios and overlays for Chaos Emperor Dragon, Ring of Destruction, and Crush Card Virus.
- [ ] Audit the other forbidden entries. Keep alternate-win cards and the other worker's three entries unchanged.
- [ ] Allow audited cards only after live proof. Record a specific reason for each card that stays forbidden.
- [ ] Update the overlay manifest, rule list, proof catalog, ADR, and scenario document.
- [ ] Run targeted scenario and integration checks. Run TypeScript checks for shared and duel-server.
- [ ] Review the changes. Make small commits with the required trailers. Do not push.
- [ ] Remove generated build folders. Write the report and record the final commit SHA.

Card script work has separate file ownership. The main worker integrates the manifest, rules, catalog, and documents.
