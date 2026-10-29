# Round 7: grounded Haiku bridge text

Run date: 2026-10-29. Node 22.23.3. Worktree `.worktrees/archetype-drilldown`, branch `feat/archetype-bridges`. Active model: **`claude-haiku-5-5` only**. Sonnet is retained only for reading and billing historical records; it cannot be selected for new requests.

The final live measurement completed all ten pairs with two independent verdict reviews each: **9 shown, 1 invalid, 0 held for review, and 0 pending**. All provider calls completed without transport/API errors. The fact-check changes text only; it does not supply a third verdict or modify either grade.

Own reading found no direct rules contradictions in the final shown pros, cons, or lock notes. Some setup details remain implicit; the per-pair notes identify them. Earlier overbroad claims and conservative fact-check rejections are documented below.

Code generates the pro choices from checked reasons and action origins, including the distinction between Deck searches and GY recovery. The request schema restricts Haiku to those exact choices, and only confirmed choices survive. Code validates each con/lock sentence's card citations and normalized quote substrings. A separate Haiku yes/no call then filters the remaining sentences. Missing or duplicate answers, invalid replies, truncation, and service/budget failures fail closed for text. Citations and drop reasons live in `text_audit` in storage; player API review fields omit that audit. Untrusted replies cannot mark their own sentences as already checked.

Every shown pair retains this deterministic warning: **Card text conditions and costs apply; the line has not been engine-verified**. Empty cons or lock notes below mean no sentence is shown; they do not assert that a card has no requirements or restrictions. Printed lock data supplies the fallback when a model lock note does not survive.

## Final verdicts and costs

Costs use returned input, cache-write, cache-read and output usage, including thinking tokens, with the repository's billing table in `packages/shared/src/cards/effects/bridge-judge-model.ts`. Each call is rounded upward to a microdollar. These are ordinary online requests; no Batch discount is applied here. Runtime and Batch fact-check requests have their own reservations and settlements.

| Pair | Mechanic | Skeptic | Gate / shown grade | Judge USD | Fact-check USD | Pair USD | Sentences dropped |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: |
| Odion -> Ashtra | valid / good | valid / good | shown / good | $0.003337 | $0.001145 | $0.004482 | 2 |
| Odion -> Argostars | valid / niche | valid / niche | shown / niche | $0.003655 | $0.001015 | $0.004670 | 4 |
| Snake-Eye -> Fire King | valid / niche | valid / niche | shown / niche | $0.003253 | $0.000907 | $0.004160 | 5 |
| Snake-Eye -> Diabell | valid / niche | valid / niche | shown / niche | $0.003757 | $0.001037 | $0.004794 | 4 |
| Branded -> Despia | valid / good | valid / niche | shown / niche | $0.003354 | $0.001222 | $0.004576 | 4 |
| Branded -> Bystial | valid / niche | valid / niche | shown / niche | $0.003378 | $0.001126 | $0.004504 | 4 |
| Kashtira -> Tearlaments | invalid / risky | invalid / risky | invalid | $0.002355 | $0.000351 | $0.002706 | 0 |
| Swordsoul -> Tenyi | valid / niche | valid / niche | shown / niche | $0.002986 | $0.001152 | $0.004138 | 1 |
| Danger! -> Dark World | valid / niche | valid / niche | shown / niche | $0.003997 | $0.000661 | $0.004658 | 4 |
| Blue-Eyes -> Black Luster Soldier | valid / niche | valid / niche | shown / niche | $0.004547 | $0.001038 | $0.005585 | 3 |

**Final ten-pair cost: $0.044273.** 39 paid calls: 20 verdict calls and 19 fact-check calls.

## Filtering measurements

Across both judges' cons and lock notes, **52 sentences were audited; 21 survived and 31 were dropped**. Counts include the judge whose review was not selected for display. Choosing one review by grade is not counted as a dropped sentence.

| Drop reason | Count | Meaning |
| --- | ---: | --- |
| `missing_quote` | 0 | No exact sentence-to-citation entry. |
| `invalid_quote` | 0 | Card missing, empty/too-short quote, or normalized quote absent from that card's text. |
| `fact_check_no` | 25 | Haiku answered no for that sentence. This is a model decision, not proof the sentence is false. |
| `fact_check_unavailable` | 6 | No unique usable yes/no answer; the call stops are recorded per pair below. |

The filter is conservative and can reject supported statements. For example, earlier measurements rejected a GY setup statement in one review while accepting essentially the same statement in the other. The final scope check also rejects vague or blanket claims about multi-effect cards. This trades some explanation coverage for fewer unsupported claims.

## Final shown text, by pair

The following pros, cons, and lock notes are copied from `shownBridge(...).review`, rather than reconstructed from raw model replies. Every dropped sentence is listed separately with its stored reason. Dropped text is diagnostic output and can contain rules errors; do not read it as rules guidance. The own-reading notes distinguish false claims from omitted setup.

### Odion -> Ashtra

Gate: **shown**. Pair cost: **$0.004482**.

**Pros:**

- Temple of the Kings allows Ashtra Divine Domain to be activated the turn it was Set, subject to its printed conditions.

**Cons:**

- Ashtra Divine Domain's negate mode needs the opponent to control no face-down cards.

**Lock note:** Ashtra Divine Domain can only be activated once per turn.

**Line:** Temple of the Kings → Ashtra Divine Domain

**Dropped sentences: 2.**

- mechanic, `cons`, `fact_check_no`: Temple of the Kings only permits activating a Trap the turn it was Set.
- skeptic, `cons`, `fact_check_no`: Temple of the Kings lets Ashtra Divine Domain be activated only on the turn it was Set, so the Trap must be Set this turn before it can be activated.

**Own reading of the card texts:** No rules error found in the shown text. Temple permits one Trap activation on its Set turn; it does not make the Set turn the only turn the Trap can be activated, and it does not permit activation from hand. Divine Domain's negate mode needs both an opposing Spell/Trap activation and no opposing face-down cards; the shown con states the latter as a necessary condition. Its once-per-turn activation limit is printed explicitly.

### Odion -> Argostars

Gate: **shown**. Pair cost: **$0.004670**.

**Pros:**

- Temple of the Kings allows Argostars - Slayer Eteo to be activated the turn it was Set, subject to its printed conditions.

**Cons:**

- Argostars - Slayer Eteo's Special Summon effect requires an opponent's card or effect activation.

**Lock note:** None shown.

**Line:** Temple of the Kings → Argostars - Slayer Eteo

**Dropped sentences: 4.**

- mechanic, `cons`, `fact_check_no`: Argostars - Slayer Eteo has no own-turn effect beyond placing itself face-up in the Spell & Trap Zone.
- mechanic, `lock_note`, `fact_check_no`: Temple of the Kings only permits the same-turn activation, so Argostars - Slayer Eteo's own conditions still apply when it is activated.
- skeptic, `cons`, `fact_check_no`: The Set activation of Argostars - Slayer Eteo relies on its Quick Effect placing it face-up, which is once per turn.
- skeptic, `lock_note`, `fact_check_no`: Temple of the Kings lets Argostars - Slayer Eteo be activated only on the turn it was Set.

**Own reading of the card texts:** No rules error found in the shown text. Eteo's opponent-activation condition belongs to its monster-Summoning effect. It is not a condition for merely activating the Continuous Trap. The surviving con correctly names the Special Summon effect, avoiding the earlier conflation.

### Snake-Eye -> Fire King

Gate: **shown**. Pair cost: **$0.004160**.

**Pros:**

- Snake-Eye Ash adds Legendary Fire King Ponix (Level 1 FIRE) from the Deck to the hand, subject to its printed conditions.

**Cons:**

None shown.

**Lock note:** None shown.

**Line:** Snake-Eye Ash → Legendary Fire King Ponix

**Dropped sentences: 5.**

- mechanic, `cons`, `fact_check_unavailable`: Snake-Eye Ash's search requires Snake-Eye Ash to be Normal or Special Summoned first.
- mechanic, `cons`, `fact_check_unavailable`: Legendary Fire King Ponix cannot add Fire King Island from the Deck when merely added to hand, because its Spell/Trap search requires a Summon.
- mechanic, `lock_note`, `fact_check_unavailable`: Snake-Eye Ash's search effects can each be used only once per turn.
- skeptic, `cons`, `fact_check_no`: Snake-Eye Ash must itself be Normal or Special Summoned for its search to Legendary Fire King Ponix to happen.
- skeptic, `cons`, `fact_check_no`: The second step to Fire King Island is not established, because Legendary Fire King Ponix must be Normal or Special Summoned to use its Spell/Trap search.

Unusable call stops: mechanic fact_check: `max_tokens`. Their usage is included in the pair cost.

**Own reading of the card texts:** No rules error found in the shown text. Ash's search triggers if it is Normal OR Special Summoned; the pro does not claim a Normal Summon is mandatory. Ponix is Level 1 FIRE. The accepted search adds Ponix to hand and establishes neither its Summon nor its later Island search. Those setup details are omitted from the short shown pro, not contradicted.

### Snake-Eye -> Diabell

Gate: **shown**. Pair cost: **$0.004794**.

**Pros:**

- Dramatic Snake-Eye Chase can place Diabellstar Vengeance on the field, subject to its printed conditions.

**Cons:**

None shown.

**Lock note:** None shown.

**Line:** Dramatic Snake-Eye Chase → Diabellstar Vengeance

**Dropped sentences: 4.**

- mechanic, `cons`, `fact_check_no`: Dramatic Snake-Eye Chase only places Diabellstar Vengeance face-up in a Spell & Trap Zone as a Continuous Spell, not Special Summoning it.
- mechanic, `cons`, `fact_check_no`: Diabellstar Vengeance's Special Summon effect requires banishing 1 Spell and 1 Trap from your hand and/or GY.
- skeptic, `cons`, `fact_check_no`: Placing Diabellstar Vengeance uses an open Spell & Trap Zone, so the line needs a free zone.
- skeptic, `cons`, `fact_check_no`: Dramatic Snake-Eye Chase's End Phase Special Summon requires banishing Dramatic Snake-Eye Chase from the GY.

**Own reading of the card texts:** No direct rules contradiction found in the shown text. Chase places Vengeance in the Spell & Trap Zone as a Continuous Spell; it does not immediately Summon it as a monster. Chase's separate GY effect can Special Summon that card during the End Phase. The short pro says only "place ... on the field" and leaves these important details to the printed conditions; it is less informative than a full play sequence.

### Branded -> Despia

Gate: **shown**. Pair cost: **$0.004576**.

**Pros:**

- Branded Opening adds Despian Tragedy (Level 1 DARK) from the Deck to the hand, subject to its printed conditions.

**Cons:**

None shown.

**Lock note:** Branded Opening: Discard 1 card, then take 1 "Despia" monster from your Deck, and either add it to your hand or Special Summon it in Defense Position, also for the rest of this turn after this card resolves, you cannot Special Summon monsters from the Extra Deck, except Fusion Monsters.

**Line:** Branded Opening → Despian Tragedy

**Dropped sentences: 4.**

- mechanic, `cons`, `fact_check_no`: Despian Tragedy's own search effect requires it to be sent to the GY or banished by a card effect, which the accepted line does not use.
- skeptic, `cons`, `fact_check_unavailable`: Branded Opening's discard happens during its resolving effect, not as a cost, so it needs a card in hand to discard.
- skeptic, `cons`, `fact_check_unavailable`: Despian Tragedy's own effect requires it to be sent to the GY or banished by a card effect, so the search does not trigger that effect.
- skeptic, `lock_note`, `fact_check_unavailable`: After Branded Opening resolves, you cannot Special Summon monsters from the Extra Deck for the rest of that turn, except Fusion Monsters.

Unusable call stops: skeptic fact_check: `max_tokens`. Their usage is included in the pair cost.

**Own reading of the card texts:** No rules error found in the shown text. Opening discards during resolution, rather than as an activation cost, and its non-Fusion Extra Deck restriction starts after it resolves. The printed fallback reproduces those distinctions. Adding Tragedy to hand does not trigger Tragedy's sent-to-GY/banished-by-effect search.

### Branded -> Bystial

Gate: **shown**. Pair cost: **$0.004504**.

**Pros:**

- Branded Regained can Special Summon Bystial Druiswurm, subject to its printed conditions.

**Cons:**

None shown.

**Lock note:** None shown.

**Line:** Branded Regained → Bystial Druiswurm

**Dropped sentences: 4.**

- mechanic, `cons`, `fact_check_no`: The Branded Regained Special Summon requires an opponent's Normal or Special Summon to trigger.
- mechanic, `cons`, `fact_check_no`: Bystial Druiswurm must already be in the Graveyard, because Branded Regained only targets a Bystial monster in your GY.
- mechanic, `cons`, `fact_check_no`: Branded Regained's recovery effect is limited to once per turn.
- skeptic, `cons`, `fact_check_no`: Branded Regained's Special Summon needs the opponent to Normal or Special Summon a monster first, which you cannot force.

**Own reading of the card texts:** No direct rules contradiction found in the shown text. Regained can revive Druiswurm, but needs Druiswurm already in your GY and an opponent's Normal/Special Summon outside the Damage Step. Its revival effect is once per turn and once per Chain. The short conditional pro does not enumerate that setup; filtered-out cons must not be interpreted as absence of requirements.

### Kashtira -> Tearlaments

Gate: **invalid**. Pair cost: **$0.002706**.

**Pros:** None shown.

**Cons:** None shown.

**Lock note:** None shown. The verdict gate hides this pair.

**Dropped sentences: 0.**

None.

**Own reading of the card texts:** No player-facing rules text is shown because both judges rejected this candidate. This is the verdict for the supplied candidate, not a conclusion that the two complete archetypes cannot work together. Tearlaments Kashtira's own Summon/mill effects and Cryme's conditions still have the meanings printed on those cards.

### Swordsoul -> Tenyi

Gate: **shown**. Pair cost: **$0.004138**.

**Pros:**

- Swordsoul Emergence adds Tenyi Spirit - Vishuda (Level 7 DARK) from the Deck to the hand, subject to its printed conditions.

**Cons:**

- Swordsoul Emergence adds Tenyi Spirit - Vishuda only if you control a Synchro Monster.
- Tenyi Spirit - Vishuda's hand Special Summon requires that you control no Effect Monsters.

**Lock note:** None shown.

**Line:** Swordsoul Emergence → Tenyi Spirit - Vishuda

**Dropped sentences: 1.**

- skeptic, `cons`, `fact_check_no`: The search adds Tenyi Spirit - Vishuda to hand without Summoning it, and its own hand Special Summon needs you to control no Effect Monsters.

**Own reading of the card texts:** No rules error found in the shown text. Emergence can add the non-Swordsoul Wyrm Vishuda only while you control a Synchro Monster. Vishuda's own hand Special Summon requires no Effect Monsters. A search does not waive that Summoning requirement. Mo Ye's Token restriction is relevant if that separate Token line is used; it does not stop adding Vishuda to hand.

### Danger! -> Dark World

Gate: **shown**. Pair cost: **$0.004658**.

**Pros:**

- Danger! Zone can discard Beiige, Vanguard of Dark World, subject to its printed conditions.

**Cons:**

- Danger! Zone can only be activated once per turn, so this discard line can be run only once per turn.

**Lock note:** None shown.

**Line:** Danger! Zone → Beiige, Vanguard of Dark World

**Dropped sentences: 4.**

- mechanic, `cons`, `fact_check_no`: Danger! Zone must discard 2 cards including at least 1 Danger! card, so a Danger! card must be in hand after its draw.
- mechanic, `cons`, `fact_check_no`: Beiige, Vanguard of Dark World must be chosen as one of the 2 cards that Danger! Zone discards, since its Special Summon needs a discard by card effect.
- skeptic, `cons`, `fact_check_no`: Danger! Zone discards 2 cards on resolution, so Beiige, Vanguard of Dark World must be in hand after the draw of 3.
- skeptic, `cons`, `fact_check_no`: The second discarded card must be a Danger! card, so the line needs another Danger! card in hand.

**Own reading of the card texts:** No direct rules contradiction found in the shown text. Danger! Zone draws and then discards by effect, so discarding Beiige to the GY can trigger Beiige. The discard needs to include at least one Danger! card; merely having Beiige is insufficient. The short pro is conditional and does not claim that Zone itself can activate from hand or on its Set turn.

### Blue-Eyes -> Black Luster Soldier

Gate: **shown**. Pair cost: **$0.005585**.

**Pros:**

- Chaos Form names Black Luster Soldier.

**Cons:**

- Blue-Eyes Abyss Dragon's search also carries its printed field or GY condition on a named Dragon.
- Super Soldier Ritual's Ritual Summon needs Tributes from hand or field totaling exactly 8 Levels.

**Lock note:** None shown.

**Line:** Blue-Eyes Abyss Dragon → Super Soldier Ritual

**Dropped sentences: 3.**

- mechanic, `cons`, `fact_check_no`: Blue-Eyes Abyss Dragon's search only works if it was Special Summoned.
- skeptic, `cons`, `fact_check_no`: Blue-Eyes Abyss Dragon's search only happens if it is Special Summoned.
- skeptic, `cons`, `fact_check_no`: Super Soldier Ritual must also Tribute monsters from hand or field totaling exactly Level 8.

**Own reading of the card texts:** No direct rules contradiction found in the shown text. Chaos Form explicitly names Black Luster Soldier. Abyss Dragon's Ritual Spell search requires its Special Summon and Blue-Eyes White Dragon on your field or in your GY. Super Soldier Ritual's Ritual Summon uses Tributes totaling exactly 8 Levels, while its separate GY effect does not require those Tributes. A blanket "when used" Tribute claim is therefore inaccurate; that wording motivated the final scope-check change.

## Iterations and total live spend

- First ten-pair pass: **$0.035164**. It exposed a judge reply spending all 4,096 output tokens on thinking and a sentence-splitting bug inside Danger! Zone. The parser/source-zone review fixes and output allowance changes were applied before the next measurement.
- Second ten-pair pass: **$0.039774**. It exposed the overbroad Super Soldier Ritual "when used" Tribute statement. The final prompts require effect-specific scope, and deterministic pros now say "printed conditions" rather than narrowing that qualification to activation conditions.
- Final ten-pair pass above: **$0.044273**.
- **Total approved diagnostic spend for this round: $0.119211.**

Judges now have an 8,192-token output ceiling so thinking can finish before the structured reply. The cheap fact-check ceiling remains 1,024 tokens; a truncated fact-check drops its pending sentences and remains billed. Historical reservation constants remain unchanged for ledger validation.

## Validation and repository state

**69 targeted integration tests passed** across these five files:

- `packages/shared/tests/bridge-judge.integration.test.ts` — 41 tests, including deterministic origins, confirmed pro choices, quote validation, forged-audit rejection, per-sentence filtering, cost settlement, failure handling, name punctuation, and printed-lock fallback.
- `scripts/effects/tests/bridge-batch.integration.test.ts` — 11 tests, including durable fact-check follow-up batches, publication, replay, and historical model billing.
- `packages/duel-server/tests/bridge-api.integration.test.ts`, `bridge-search-jobs.integration.test.ts`, and `bridge-workers.integration.test.ts` — 17 tests combined.

```sh
prlimit --core=0 -- npx vitest run packages/shared/tests/bridge-judge.integration.test.ts scripts/effects/tests/bridge-batch.integration.test.ts packages/duel-server/tests/bridge-api.integration.test.ts packages/duel-server/tests/bridge-search-jobs.integration.test.ts packages/duel-server/tests/bridge-workers.integration.test.ts --maxWorkers=1
prlimit --core=0 -- npx tsc -p scripts/effects/tsconfig.json --noEmit
prlimit --core=0 -- npm run typecheck --workspace=packages/shared
prlimit --core=0 -- npm run typecheck --workspace=packages/duel-server
```

All three typechecks passed. Shared was built for the live script; its generated `packages/shared/dist` output was removed afterward. No new unit tests were added. The live runs used disposable in-memory databases and did not import approvals into the application database. No writes were made to `data/duel-engine` or `data/duel-engine-next`. No push or PR was made.

## Commits

- `932a63d5e` — fix: render bridge pros from checked evidence actions
- `42918081e` — fix: ground and fact-check Haiku bridge notes with billed text filtering
- `c3debe427` — fix: reserve and collect bridge text fact-check batches
- `a2b14af4d` — fix: pin active bridge judges to Haiku 5.5
- `c27f77fd8` — chore: measure shown bridge text and fact-check costs for ten pairs
- `add1f5c18` — fix: bind shown bridge text to checked and confirmed provenance
- `658d4bf97` — fix: reserve room for complete Haiku reviews after thinking
- `dd92d848c` — fix: preserve card-name punctuation in grounded bridge sentences
- `d537f11e6` — docs: describe grounded Haiku bridge judging and text batches
- `f18f1d6f6` — fix: require effect-specific scope in grounded bridge notes

The report itself is committed separately after these implementation and runbook commits.
