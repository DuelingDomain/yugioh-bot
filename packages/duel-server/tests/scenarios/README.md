# Engine scenario tests (Layer 1)

A scenario starts a duel from an exact board, plays a few actions, and checks the result.
No turns are played to reach the board. Scenarios run on the real engine (ocgcore wasm), so they test real card scripts.

## Run

Always set `DUEL_DATA_DIR`. The live bundle has a stale Domain wasm.

```bash
cd packages/duel-server
export DUEL_DATA_DIR=<repo>/data/duel-engine-next
npx vitest run tests/scenarios                      # all scenarios
npx vitest run tests/scenarios/spells.test.ts       # one family
npx vitest run tests/scenarios -t "raigeki"         # by name
SCENARIO_TAG=domain npx vitest run tests/scenarios  # by tag
SCENARIO_CARD="Raigeki" npx vitest run tests/scenarios   # scenarios that use a card (name or code)
SCENARIO_CODES=12580477,44095762 npx vitest run tests/scenarios  # by changed card codes
SCENARIO_ID=mirror-force-destroys-attackers npx vitest run tests/scenarios
npx tsx tests/support/list.ts                       # list scenarios (honors the same filters)
```

Scenarios that are filtered out are shown as skipped.

## Find card names

Names must match `cards.cdb` exactly. Unknown or ambiguous names fail fast and list suggestions or codes.
You can also use a passcode.

```bash
npx tsx tests/support/find-card.ts "Raigeki"
```

## Write a case

Add a scenario to `tests/scenarios/cases/<family>.ts` (a new family needs a `<family>.test.ts` shim, copy `battle.test.ts`).
`registry.test.ts` checks this, checks unique ids, and checks that `source` and `tags` are not empty.

```ts
defineScenario({
  id: "raigeki-destroys-all-opponent-monsters",   // unique, kebab-case
  title: "Raigeki destroys every monster the opponent controls",
  source: "https://yugioh.fandom.com/wiki/Raigeki",  // rule or card text that justifies the result
  tags: ["spell", "destroy", "mass-removal"],
  setup: {                                          // BoardSpec
    p0: { hand: ["Raigeki"] },
    p1: { monsters: ["Summoned Skull", faceDown("Celtic Guardian")] },
  },
  steps: [
    activate("Raigeki"),
    expectBoard({ p1: { monsters: [], grave: ["Summoned Skull", "Celtic Guardian"] } }),
  ],
});
```

### Board setup (`setup`)

`mode` ("normal" default, or "domain"), `masterRule`, `turn` ("p0" default), `attackFirstTurn`, `deckSize`, and one entry per duelist `p0`..`p3`.
A duelist has: `lp`, `hand`, `monsters` (zones 0-4, then EMZ 5-6), `spells` (0-4), `field`, `pendulum` (2), `grave`, `banished`,
`deck` (top first; the rest is filler "Mystical Elf"), `extra`, `deckMaster` (required in domain mode, not allowed otherwise).
Use `faceDown(card)`, `defense(card)`, `xyz(card, materials)` for stance.
The scenario starts in Main Phase 1 of the turn player. The harness declines optional Draw Phase chain windows on its own.
`p2` and `p3` and `teams` are in the types. They throw until the multiplayer core exists.

### FFA opening draw in older fixtures

Every FFA3 and FFA4 duelist draws on their first turn, including p0, in Standard
and Domain. New scenarios must use `defineScenario` from `support/dsl.ts` and
write the hand and Deck counts after that draw explicitly.

`multiplayer/ffa-first-draw.ts` exports `defineScenarioWithFfaFirstDraw` for
older fixtures whose p0 expectations exclude the opening draw. The wrapper
copies the scenario and adds the tag `ffa-first-draw-included`. For a custom
p0 `deck` without `deckSize`, it puts a filler card (`Mystical Elf` by default)
before the custom cards. With an explicit `deckSize`, it keeps the custom Deck
and accounts for its top card and later draws instead.

In each `expectBoard` with a living p0, the wrapper adds the opening card to
an exact hand list or increases a hand `count` by one. It decreases a positive
`deckCount` by one; zero stays zero. Other seats and unspecified lists stay
unchanged. It stops changing p0 after `expectEliminated("p0")` and leaves a p0
snapshot at `lp: 0` unchanged.

The optional second argument is `{ card, destination }`. `card` selects the
opening card; `destination` selects `hand` (default), `grave`, or `banished`
when the scenario moves that card. The wrapper adjusts expectations; the
scenario must still perform the action that moves the card.

To opt out, add `ffa-first-draw-included` to `tags` and write the opening draw
in the setup and expectations yourself. The wrapper also passes Tag, 1v1,
the default format, and `turn: "p1"` fixtures through unchanged. Many older
files still import the wrapper `as defineScenario`; their literal values are
the input to this transform. Removal of those aliases is a later cleanup.
The direct `rule-proof-ffa-order.test.ts` proves the draw rule on real cores.

### Actions

`activate`/`respond`, `normalSummon`, `setCard`, `specialSummon`, `changePosition`, `attack(attacker, target | "direct")`,
`changePhase("battle"|"main2"|"end")`, `endTurn`, `pass`.
Answers: `select(...cards)`, `choose(labelSubstring)`, `zone(owner, "m2")`, `position`, `yes`, `no`, `finish`, `number`, `announce`, `auto`, `raw`.
A card can be a name, a code, or `{ card, owner, from, seq, nth, effect }` to tell copies apart.
Add `by: "p1"` to act for another duelist.

Routine zone and position prompts are answered on their own (first zone, Attack Position).
Use `zone()`, `position()` or `expectPrompt()` when you want to control or check them.
If an effect has one legal target, the engine picks it. Do not add a `select` step in that case.
If an action matches no legal option, the error lists all legal options.

### Expectations

`expectBoard` (lp, hand, grave, banished, extra, deckCount, `zones` like `m0`, `emz0`, `s2`, `f`, `pz0`, `monsters`, `spells`, `deckMaster`),
`expectEvents` (ordered subsequence), `expectNoEvent`, `expectResolved` (chain resolve order), `expectChain`,
`expectPrompt` (kind, title, context, `offers`, `notOffers`), `expectNoPrompt`,
`expectOffered` / `expectNotOffered`, `expectResult`.

N-seat tables (FFA3, FFA4, Tag) add `expectEliminated`, `expectLp`, `expectTurn`, `expectResponseOrder`, `expectPickSeats`, `pickOpponent`,
`surrender` / `eliminate(seat, reason?)`, and three steps that inspect or probe the open prompt (they never auto-answer a routine zone prompt):
`expectPickOptions` (exactly these options, or `include` / `exclude` / `count`; an option is named by `seat`, `card`, `label` or `id`),
`expectLabel(option, text)` (the label the player sees, not a Lua label) and `expectRetry(answer, { as, error, by })` (the engine must
refuse the answer: same prompt, same state).

### Known engine bugs

Set `knownBug: "why"`. The scenario runs as `it.fails`: it must fail now, and it turns red when the bug is fixed. Then remove the field.

## Files

- `tests/support/board.ts`: board compiler (Lua `Debug.AddCard` through the `startupScripts` hook of `createEngineGame`).
- `tests/support/dsl.ts`: types and step builders. `session.ts`: runner, `runner.ts`: Vitest glue.
- `tests/support/card-catalog.ts`: name to code. `select.ts`: filters and tags. `registry.ts`: loads all families.

## Turn a failure into a scenario

`scripts/failure-to-scenario.ts` replays a fuzz failure JSON or a browser duel journal to answer N, reads the board of both seats,
and writes a scenario file into `tests/scenarios/generated/` (see the README there).

```bash
npx tsx scripts/failure-to-scenario.ts --file tests/fuzz/failures/<case>.json --step 120
npx tsx scripts/failure-to-scenario.ts --file duel-journal-<slug>.json --step 37 --out tests/scenarios/generated/x.ts --name x
```

It rebuilds LP, hand, monster zones (position, face-down, Xyz materials), Spell/Trap, Field and Pendulum zones, GY, banished,
Extra Deck, Deck content (deck list minus visible cards; the order is not known), turn player and the Deck Master in Domain duels.
It prints a warning list for state the DSL cannot rebuild: counters, Equip links, continuous effects, once-per-turn usage, summon counts,
summon type, turn counters, Domain returns and leave cost, an open prompt or chain. The scenario always starts in Main Phase 1.
