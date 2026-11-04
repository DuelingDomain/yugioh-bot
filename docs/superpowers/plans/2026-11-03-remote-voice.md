# Remote voice implementation plan

Goal: Parse close Yu-Gi-Oh phase transcripts, send a short STT vocabulary, show the parse result, and stop conversation suggestions.

The owner's task supplies the design and authorizes completion and push. Keep full-command boundaries and existing phase corrections. Use a small phonetic key plus token edit distance, with turn context for ambiguous phase names. Use the existing STT hotwords protocol; do not change the active service or local-main.

1. Read saved STT outputs and measure a fixed phrase corpus against f19ca5d20.
2. Extend only the existing activation grammar test. Check phase errors, turn context, rejected conversation, card commands, and vocabulary limits. Run it and observe failure.
3. Update the shared phase parser, LP wording, bounded client/server vocabulary, recent-card ordering, and existing voice dock text. Filter conversation before parsing or suggestions; protect known card names and remove invented sample names.
4. Build shared declarations, typecheck web, and run only the extended grammar test. Check the STT adapter with a targeted smoke check.
5. Record before/after phrase results and known limits. Review the diff, commit as WIP with no attribution, and push feat/remote-voice.

Complete: 93/93 phrase cases (baseline 42/93), 21/21 chatter cases quiet, one extended grammar test, shared build and web typecheck passed. STT adapter and live socket checks passed. Read-only review findings were fixed. Full table: `docs/remote-duels/voice-recognition-2026-11-03.md`.
