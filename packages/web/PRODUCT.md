# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Yu-Gi-Oh players in organized Discord communities. They draft cards together (booster, cube, or theme drafts), then duel each other in the browser with the decks they drafted or imported. Secondary audience: organizers who run tournaments, and spectators who watch duels. Players use the duel field on desktop and on phones, and both must be equally good.

## Product Purpose
Duelists Kingdom is the play surface for a Discord community: drafts, tournaments, and duels start and notify through Discord, and the web app is where people actually play. The duel field runs a full automatic rules engine (ygopro core, Master Rule 5) so players only make legal choices; the engine owns rules, the UI owns clarity. Success is a duel that is fast to play, easy to read at a glance, and memorable at its big moments.

## Positioning
- Draft then duel: the same community and the same app take a player from drafting a pool to dueling with it.
- Domain format: a custom 1v1 format where each player has a Deck Master in a dedicated zone, with returns and an LP surcharge. No other simulator has it.
- Browser, no install: a full automatic engine in the browser, with Discord sign-in only.
- The best-looking, most readable board of any simulator.

## Operating Context
- Duels are created from the web dashboard or Discord, with lobby settings (format, engine and Master Rule, banlist, card pool, starting LP, hand size, draw count, turn timer, timeout rule, deck validation, opening order, visibility).
- Players import decks as YDK files or pasted YDK, then mark Ready; the host validates decks.
- Live state arrives through the duel host and WebSocket; the practice bot can fill a seat.
- Spectators can watch; the duel log and card inspector are part of play.

## Capabilities and Constraints
- Formats today: Standard 1v1 and Domain 1v1. Planned later: 3-way and 4-way duels (build on the same engine logic; do not design them yet, but do not block them).
- Engine-legal actions only. No manual free-move mode, no Resolve button.
- Board topology follows the orthodox Dueling Nexus layout: per player 5 Main Monster Zones and 5 Spell/Trap Zones (Pendulum markers on the first and fifth), 2 shared Extra Monster Zones, Field Spell, Main Deck, Extra Deck, Graveyard, and Banished piles. Domain adds a Deck Master zone per player, outside the normal zones.
- The phase bar (DP, SP, M1, BP, M2, EP) stays at the bottom and stays visible.
- Side panels stay: a left inspector with Card and Log, and right Deck Master docks in Domain.
- Pace: fast by default, short cinematic moments for big summons; everything skippable, with a reduced-motion setting that the app honors.
- Stack: Next.js 16 App Router, React client components, CSS modules. three.js is allowed for signature moments.

## Brand Commitments
- Name: Duelists Kingdom.
- The Obsidian Arena look is user-approved and binding: navy-black obsidian surface, fine antique-gold lines, restrained purple for active and selected states. Reference: `designs/duel-ui/nexus-classic/variation-2-obsidian-arena.webp`.
- Rejected looks: slate-blue backgrounds, temple or tomb scenery, generic AI-dashboard styling.

## Evidence on Hand
- Approved reference and state drafts: `designs/duel-ui/nexus-classic/` (main 1, battle, main 2 with chain). The drafts are generated images, not implemented screens.
- Card art is loaded from the YGOPRODeck-backed card catalog and image cache. Card art and printed card text are third-party assets; do not invent card text.
- There are no testimonials, player counts, or benchmarks. Do not invent them.

## Product Principles
1. The engine decides, the UI explains: show only legal actions, and make why and what next obvious.
2. Speed over ceremony: no confirm modals for legal choices; menus anchor to the card.
3. The board is always the truth: live state is never hidden behind an animation for long.
4. Big moments earn spectacle: summons, attacks, chains, and LP swings feel great, then get out of the way.
5. Every phase reads at a glance on a phone and on a wide monitor.

## Accessibility & Inclusion
Honor `prefers-reduced-motion` and the in-app Motion setting. Keyboard focus must work on cards, menus, and prompts. Color is never the only signal for legal targets, chain links, or ownership.
