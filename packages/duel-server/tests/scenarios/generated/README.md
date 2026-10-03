# Generated scenarios

Files here are written by `scripts/failure-to-scenario.ts` from a fuzz failure or a browser duel journal.
Each file exports `scenarios: Scenario[]`, like the files in `../cases`.
`generated.test.ts` loads every other `.ts` file in this directory and runs it with the normal scenario runner.

## Run

```bash
cd packages/duel-server
export DUEL_DATA_DIR=<repo>/data/duel-engine-next
npx vitest run tests/scenarios/generated
SCENARIO_ID=<id> npx vitest run tests/scenarios/generated
```

## Make one

```bash
npx tsx scripts/failure-to-scenario.ts --file <failure.json | duel-journal-slug.json> --step N [--out path] [--name id]
```

A new file only checks that the setup rebuilds the captured board (one `expectBoard` step).
Then edit it: add the actions, write the expected result by hand (`// TODO expected result`), and set a real `source`.
When the scenario is good and the bug is fixed, move it to `../cases/<family>.ts`.
Delete a generated file that you do not keep. The warning list in the file header says which state was not rebuilt.
These files are not part of `registry.test.ts`, so they do not need a `<family>.test.ts` shim.
