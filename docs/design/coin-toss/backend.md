# Coin toss FX: backend contract

One `MSG_TOSS_COIN` produces one public event, with every result in engine order:

```ts
{
  id: number;
  kind: "toss";
  seat: number;
  text: string; // "Coin toss: Heads, Tails, Heads"
  toss: { type: "coin"; results: ("heads" | "tails")[] };
  card?: DuelCardInfo; // Source card, including code and name.
  sourceCode?: number;
  chainIndex?: number;
}
```

The source is the chain link currently resolving, not the last link in the chain.
The core's coin message has no source card field. When no link is resolving,
the event omits the source. When the database has no card record, `sourceCode`
and `chainIndex` remain available. The shared `DuelToss` type also reserves
`{ type: "dice"; results: number[] }`. No dice event is emitted.

Both `src/views.ts` and `src/legacy/views.ts` emit the event in `observeDuelEvent`.
Both engines record it through the normal event path. The result log line is
written at that same message, after the event receives its ID:

```ts
{ id: number; text: string; eventId?: number }
```

For a coin line, `eventId` is the toss event's `id`. Use that ID to hide the line
while the toss plays, then release it after the final result lands. Release
historical lines at once when their event was skipped or is outside the retained
event window. Lines from older saved views have no `eventId`; show them normally.
The backend sends text and results at once. The UI must apply the hold to each
visible log, summary and screen reader announcement. No timer is imposed by the server.

All seats and spectators receive the same event and log link in 1v1, FFA3,
FFA4 and Tag. Neither depends on the viewer's hidden cards.

Replay and recovery run the saved answers and seed through the same event path.
They reproduce the toss results, source, event ID and log link. Replay deltas keep
each event once; `buildReplayTimeline` retains the link through seeking.
Snapshots retain the normal 400-event/400-line window. Repeated reads do not
create events. Follow MoveFx's `collectFreshEvents`, `replayFrom` and `skipThrough`
rules: on an ordinary mount, start the cursor at `maxEventId(events)`; on an
explicit replay, use `replayFrom`; consume each fresh ID once. Old tosses have
their text/summary available without another flip.

Non-React event handling now gives tosses no centre banner, no generic audio cue,
no history tile and no battle or camera lock. The toss layer owns its own timing.

## UI work still required

No React component was edited, and none needed a compile fallback.
Paths below are relative to `packages/web/src/components/duel/`.

- `room.tsx`: mount the coin layer and pass the start/recovery cursors.
- `table/table-shell.tsx`: mount it at the table centre for FFA3 and FFA4.
- `tag/tag-fx.tsx`: mount it for Tag.
- `solid/solid-room.tsx`: add it to the separate 3D FX layer.
- `replay.tsx`: mount it for replay and apply the log hold in `LogList`.
- `log-line.tsx`: use `eventId` in `MatchSheetLog` and hide held entries before rendering them.
- `text-log.tsx`: it re-exports `MatchSheetLog`; check every caller of that shared log.
- `feedback.tsx`: give tosses a screen reader announcement at landing. `hasCentreBanner`
  already suppresses the toast and `feedback-audio.ts` suppresses generic audio.
- `history-rail.tsx` and `table/history-strip.tsx`: if adding toss history,
  release results at landing. `history-model.ts` currently ignores toss events.

`summon-fx.tsx` already ignores toss through its default branch. It needs no
change. Keep the existing coin/dice log category rule in `log-category.ts`.
Use the approved `.fx-demo/coin-flip/INTEGRATION.md` notes for animation timing,
chain scheduling, prompt holds and reduced motion.

## Targeted tests

- `tests/toss-events.test.ts`: both views, ordered results, source lookup and
  clearing, public projection for every format, copied result arrays, log links,
  and no dice emission.
- `tests/scenarios/coin-toss.test.ts`: real Barrel Dragon in merged 1v1 and
  FFA3 (seat 2), and real Time Wizard in legacy 1v1. Each checks the source,
  result count, public views, event order, log link, repeat snapshots and saved-answer replay.
- Web event queue and replay timeline tests: no generic banner/cue, cursor
  de-duplication and log links across replay frames and seeks.
