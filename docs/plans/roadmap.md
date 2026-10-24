# Roadmap

Open and parked work only. Finished work is in the git history and in the docs for each feature. Checked against the code on 2026-10-24.

## Multi-player duels (Tag 2v2, 3-way, 4-way) - done

Built and deployed (PR #101 and #124, 2026-10-04). Rules: [ADR-0002](../adr/0002-multiplayer-duel-rules.md). Test layers: [ADR-0003](../adr/0003-duel-test-layers.md). Tables are open when `MULTIPLAYER_TABLES` is on, which is the Compose default. The 4-player table uses the 2x2 grid on main.

## Open: UI review items

| Item | Where it is today |
|---|---|
| Remove the dead "Game engine" select. It has one disabled choice, "Automatic". | `packages/web/src/components/duel/creator.tsx:386` |
| Use one shared format-name helper. The names differ: `FORMAT_LABELS` in `components/duel/table-format.ts` says "2v2 Tag"; `components/duel/multi-seat.ts` and `lib/bug-report.ts` have their own maps that say "Tag 2v2". `components/duel/match-chips.tsx` has a separate map for match formats. | `table-format.ts`, `multi-seat.ts`, `bug-report.ts`, `match-chips.tsx` |
| Text under 11px. | For example `duel/between-games.module.css`, `duel/station-track.module.css`, `duel/solid/table.module.css` |

Not re-checked (needs a visual check): clock name cut-off, lobby wording, small-screen card details, clock remount and blur cost.

## Parked: theme drafts on live

Theme drafts are closed on live. `THEME_DRAFTS` is `0` in `docker-compose.yml`, and `packages/web/src/lib/theme-drafts.ts` then refuses new theme work ("Theme drafts are not open yet."). Stored theme lobbies and active theme drafts still run. To open them, set `THEME_DRAFTS=1` on the web service.

## Parked: prod script errors in the weekly card update

Parked by the owner on 2026-10-08. The code is on main (PR #273), but it stays off until the owner adds the keys. The weekly card update works without it.

When it is on, the card-data PR shows which cards had script errors in prod in the last 7 days. To turn it on:

- Add the GitHub secrets `VM_SSH_KNOWN_HOSTS` and `ENGINE_DATA_PROD_SSH_PRIVATE_KEY` (a new key used only for this). `.github/workflows/engine-data-update.yml` skips the step when either is empty.
- On the VM, add this line to `authorized_keys`: `restrict,command="sh /opt/yugioh-bot/scripts/prod-script-errors.sh" ssh-ed25519 <public-key> engine-data-prod-export`

## Parked: faster card updates

Parked by the owner on 2026-10-08. Today the card-data job runs each Monday and Thursday at 06:00 UTC (`engine-data-update.yml`) and takes new cards and scripts from Project Ignis. Possible later steps:

- Check for new cards each day, and make a PR only when Ignis or YGOPRODeck has new cards.
- Add our own scripts (and card data) for new cards that Ignis does not have yet. Today `card-script-patches` can only change a script that Ignis already has.
- A report of cards that YGOPRODeck has but Ignis does not have yet.
