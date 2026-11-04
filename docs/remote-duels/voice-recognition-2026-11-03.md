# Remote voice report — 3 November 2026

Branch: `feat/remote-voice`. Base: `f19ca5d202ef00110d1955494e69c3c748ee15d9`.

The same 93 transcript cases scored **42/93 (45.2%) before** and **93/93 (100%) after**. All 21 chatter cases now give no action and zero suggestions. This measures transcript parsing. It does not measure microphone or speech-model accuracy.

The phase parser uses Soundex and token edit distance. It keeps full-command boundaries, normalizes phase sound-alikes and number words, and uses turn state to choose between close matches. “Next phase” skips an unavailable Battle Phase. Backward phase commands stay in the same turn. The voice filter checks sentence words outside known card names. Suggestions use current table and deck names. The voice dock shows heard text and the result, including when a confirmation is open.

Evidence: the owner screenshot shows the full chatter sentence below and three wrong suggestions. Recent STT Docker logs contained connection and health lines, with no transcript text. Saved benchmark outputs in `services/stt/benchmarks/{whisper,parakeet,browser-whisper-tiny}.json` contain “Moving to stand by phase”, “In turn”, “Intern”, “And my turn”, “ash blossom enjoy a spring”, “effect failure”, “part of prosperity”, and “Castiro Fenrir”. Other spelling variants below are deliberate regression cases, not claimed live failures. “Intern” stays ignored because it is not a close phase command.

STT: the local service at port 4020 accepts `hotwords`. The installed faster-whisper API confirms support. The client sends phase names, game verbs, then card names in recent-first order. The client and decoder each cap the complete hint at 600 UTF-8 bytes. A 594-byte sample used 174 Whisper tokens. The adapter smoke check confirmed the bounded hint reaches `transcribe`. A live WebSocket silence check accepted the new client payload and returned a final response.

The running primary model is Parakeet, with optional Whisper verification. Parakeet does not use decoder hotwords; Whisper uses them when verification runs. The server cap needs the updated STT service image. No service was rebuilt, started, or stopped. This work made no edits to the main checkout or the local-main clone.

Checks passed with Node 22.23.3:

- Shared TypeScript build.
- Web typecheck: `npm run typecheck --workspace=@yugioh-discord-bot/web`.
- One existing grammar test: `vitest run --config packages/web/vitest.config.ts packages/web/tests/remote-recognition.test.ts -t 'parses activation with a named source'` (1 passed, 101 skipped).
- The same test checks card-name protection, real-card suggestions, recent-card order, the STT start payload, and rendered voice text with no chatter suggestions. No test files were added.
- STT adapter, installed API, live socket smoke checks, and read-only code review.

Table key: `quiet` means no action and zero suggestions. `none; suggestions=3` means the old UI offered three suggestions. `lp:0:-1000` means seat 0 loses 1000 LP. Each row uses turn 2, the listed current phase, and legacy/inferred Battle-entry history. Opening-turn Battle skips and explicit Battle-entry history have separate assertions in the same test.

| Phrase | Current phase | Expected | Before | After |
| --- | --- | --- | --- | --- |
| standby phase | draw | phase:standby | phase:standby | phase:standby |
| stand by phase | draw | phase:standby | phase:standby | phase:standby |
| stamby phase | draw | phase:standby | none | phase:standby |
| stand bye phase | draw | phase:standby | none | phase:standby |
| sandby phase | draw | phase:standby | none | phase:standby |
| standby face | draw | phase:standby | phase:standby | phase:standby |
| standby faze | draw | phase:standby | phase:standby | phase:standby |
| standby fase | draw | phase:standby | none | phase:standby |
| Moving to stand by phase. | draw | phase:standby | none | phase:standby |
| Moving to Standby Phase | draw | phase:standby | none | phase:standby |
| main phase two | battle | phase:main2 | phase:main2 | phase:main2 |
| main 2 | battle | phase:main2 | phase:main2 | phase:main2 |
| mane phase | standby | phase:main1 | phase:main1 | phase:main1 |
| main face | standby | phase:main1 | phase:main1 | phase:main1 |
| main phase to | battle | phase:main2 | phase:main2 | phase:main2 |
| main phase too | battle | phase:main2 | phase:main2 | phase:main2 |
| main phase one | standby | phase:main1 | phase:main1 | phase:main1 |
| main phase won | standby | phase:main1 | phase:main1 | phase:main1 |
| main 1 phase | standby | phase:main1 | phase:main1 | phase:main1 |
| second main phase | battle | phase:main2 | phase:main2 | phase:main2 |
| main phase | standby | phase:main1 | phase:main1 | phase:main1 |
| main phase | battle | phase:main2 | phase:main2 | phase:main2 |
| battle phase | main1 | phase:battle | phase:battle | phase:battle |
| battle face | main1 | phase:battle | phase:battle | phase:battle |
| bottle phase | main1 | phase:battle | none | phase:battle |
| Go to battle fays | main1 | phase:battle | none | phase:battle |
| battel phase | main1 | phase:battle | none | phase:battle |
| go to battle | main1 | phase:battle | none | phase:battle |
| enter battle | main1 | phase:battle | none | phase:battle |
| battle step | main1 | phase:battle | phase:battle | phase:battle |
| end phase | main2 | phase:end | phase:end | phase:end |
| and phase | main2 | phase:end | phase:end | phase:end |
| in phase | main2 | phase:end | none | phase:end |
| end face | main2 | phase:end | phase:end | phase:end |
| end fase | main2 | phase:end | none | phase:end |
| draw phase | end | phase:draw | phase:draw | phase:draw |
| drop phase | end | phase:draw | none | phase:draw |
| draw face | end | phase:draw | phase:draw | phase:draw |
| drow phase | end | phase:draw | none | phase:draw |
| Please, go to the main phase! | standby | phase:main1 | phase:main1 | phase:main1 |
| set phase to main two | battle | phase:main2 | phase:main2 | phase:main2 |
| phase battle | main1 | phase:battle | phase:battle | phase:battle |
| end turn | main2 | turn | turn | turn |
| pass | main2 | turn | none | turn |
| pass my turn | main2 | turn | turn | turn |
| next phase | draw | phase:standby | none | phase:standby |
| next phase | standby | phase:main1 | none | phase:main1 |
| next phase | main1 | phase:battle | none | phase:battle |
| next phase | battle | phase:main2 | none | phase:main2 |
| next phase | main2 | phase:end | none | phase:end |
| next phase | end | turn | none | turn |
| go back a phase | main2 | phase:battle | phase:battle | phase:battle |
| back to main phase one | main2 | phase:main1 | phase:main1 | phase:main1 |
| undo | main2 | undo | undo | undo |
| chain | main1 | wake | wake | wake |
| set | main1 | move | move | move |
| graveyard | main1 | move | move | move |
| GY | main1 | move | move | move |
| banish Dark Magician | main1 | move | move | move |
| I activate Trap Tracks | main1 | effect | effect | effect |
| LP minus 1000 | main1 | lp:0:-1000 | none | lp:0:-1000 |
| life points plus 1000 | main1 | lp:0:1000 | none | lp:0:1000 |
| my life points minus one thousand | main1 | lp:0:-1000 | lp:0:-1000 | lp:0:-1000 |
| and my turn | main2 | turn | none | turn |
| in turn | main2 | turn | none | turn |
| Intern | main2 | none | none | none |
| bottle fase | main1 | phase:battle | none | phase:battle |
| stndby phase | draw | phase:standby | none | phase:standby |
| mian phase | standby | phase:main1 | none | phase:main1 |
| main fase | battle | phase:main2 | none | phase:main2 |
| draw faze | end | phase:draw | phase:draw | phase:draw |
| Um and now like I've placed uh Treasure of the Kings in the monster in the spell tr um in the field zone, and... | main1 | quiet | none; suggestions=3 | quiet |
| Um I put this in the monster zone two and now I think we can continue | main1 | quiet | none; suggestions=3 | quiet |
| I activate this because I think it can help with the battle phase later | main1 | quiet | effect; suggestions=0 | quiet |
| And now I've placed Treasures of the Kings in the field zone | main1 | quiet | none; suggestions=3 | quiet |
| Like I said we should check the main phase rules after this game | main1 | quiet | none; suggestions=3 | quiet |
| Do you think I should set this in trap zone one or keep it | main1 | quiet | none; suggestions=3 | quiet |
| I was talking about the battle phase and the monster zone two | main1 | quiet | none; suggestions=3 | quiet |
| Um battle phase | main1 | quiet | none; suggestions=3 | quiet |
| Thanks for the game | main1 | quiet | none; suggestions=3 | quiet |
| The main phase is next | main1 | quiet | none; suggestions=3 | quiet |
| don't end turn | main1 | quiet | none; suggestions=3 | quiet |
| next phase later | main1 | quiet | none; suggestions=3 | quiet |
| Main phase rules are confusing | main1 | quiet | none; suggestions=3 | quiet |
| I activate this card every time my opponent starts talking about the next battle phase | main1 | quiet | effect; suggestions=0 | quiet |
| We discussed monster zone two | main1 | quiet | move; suggestions=0 | quiet |
| I activate See You Later! | main1 | effect | effect | effect |
| I activate Trap Tracks when you summon a monster | main1 | quiet | effect; suggestions=0 | quiet |
| I activate this card all the time during our games | main1 | quiet | effect; suggestions=0 | quiet |
| I activate Trap Tracks and talk about the next battle phase | main1 | quiet | effect; suggestions=0 | quiet |
| Main phase rules | main1 | quiet | none; suggestions=3 | quiet |
| main deck | main1 | quiet | none; suggestions=3 | quiet |
| I put like Trap Tracks in field zone | main1 | quiet | move; suggestions=0 | quiet |
