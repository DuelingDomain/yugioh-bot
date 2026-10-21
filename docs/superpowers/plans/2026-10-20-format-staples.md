# Format staples plan

Goal: use measured format deck usage for Suggestions and plain staple searches.

- [x] Capture the current search failure in the real-engine integration suite.
- [x] Collect bounded YGOPRODeck TCG tournament, Domain and Genesys samples.
- [x] Publish a versioned artifact with counts, mean copies and source hashes.
- [x] Require 20 decks, 10% share and at least three archetypes; reject archetype-locked cards.
- [x] Add a private saved-deck aggregate source with the same sample gate.
- [x] Use one usage reader for Suggestions and search; keep admission rules.
- [x] Carry the format through deck and draft search; preserve exact card names.
- [x] Add a bounded, additive artifact PR job to the effect-tagging workflow.
- [x] Run targeted real-catalog integration and live browser checks.
- [x] Push and open PR #421 to main; do not merge. #413 is still open, so the authorized Suggestions base remains in use.
- [x] Port to local-all, wait for other builds, publish with stop/copy/start, and remove build output.

Implementation is authorized by the supplied task specification. Use integration and e2e checks only.
