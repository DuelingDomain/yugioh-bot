# Duel field redesign — shared concept brief

Three concept prototypes for the Yugidraft duel field. Each concept is a standalone HTML/CSS/JS prototype, not app code. They exist so the user can see and compare directions, then critique them. Product truth: `packages/web/PRODUCT.md` (read it).

## Fixed for every concept (user-pinned, non-negotiable)

1. **Nexus zone layout.** Orthodox flat topology. From top to bottom: opponent hand; opponent half; the centre band with exactly TWO shared Extra Monster Zones (columns 2 and 4); your half; your hand.
   - Opponent half: left piles [Deck, GY, Banished]; S/T row and monster row, both mirrored; right piles [Extra, Field].
   - Your half: left piles [Field, Extra]; monster row, then S/T row; right piles [Banished, GY, Deck].
   - 5 Main Monster Zones and 5 S/T Zones per player. Pendulum "P" markers sit on S/T 1 and S/T 5.
   - A monster zone is ONE slot with two same-centre guides: portrait 59:86 and landscape 86:59. S/T and pile slots are portrait only.
   - Attack-position cards are upright. Defense cards rotate 90° without squashing. Face-down cards show no name or stats to the opponent.
   - Your layout may tilt the board in 3D, but the topology and order must stay exact.
2. **Bottom phase bar.** DP SP M1 BP M2 EP, always visible at the bottom, in this order, with only the current phase highlighted. You may restyle it and add meaning to it.
3. **Side panels.** A left inspector with Card and Log tabs. Right Deck Master docks (Domain format): Opponent Master on top, Your Master below. Each dock shows the art, its status (In Deck Master Zone / On field), "Returns N", and "Next surcharge X LP". Your dock also holds the legal Deck Master actions. On mobile, panels may become sheets or drawers, but they must stay one tap away.
4. **Obsidian palette.** Navy-black textured obsidian, fine antique-gold hairlines, restrained purple for active and selected states. The reference is `designs/duel-ui/nexus-classic/variation-2-obsidian-arena.webp`; state drafts are in the same folder. Rejected: slate-blue backgrounds, temple or tomb scenery, generic AI-dashboard styling (cyan on dark, glass cards, neon glows everywhere).
5. **Pace.** Fast by default. Big summons get a short cinematic moment (1.2 s max). Everything is skippable (click, Space, or Esc), and `prefers-reduced-motion` plus an in-app Motion setting (Full / Reduced) are honored.
6. **Devices.** Desktop (1280–2560 px wide) and mobile (390×844 portrait) are EQUALLY important. Both must be designed, not squeezed.
7. **Engine-legal only.** No free manual moves and no Resolve button. Menus anchor to the card, with no confirm modals for legal choices.

## What the real engine supports (design only for this)

- **Phases:** DP SP M1 BP M2 EP. The player can only press BP, M2, or EP when the engine offers it. DP, SP, and M1 are display-only. The header shows "Turn N · Phase". Today, nothing shows whose turn it is. Fix that.
- **Clock:** each player has a turn timer, e.g. 240 s. The seat that must act is marked.
- **Action prompt (main/battle):** legal cards glow on the field or in hand. Clicking one opens a menu anchored to the card, with items such as Normal Summon, Set, Special Summon, Change position, Activate <effect>, Attack. Deck Master actions appear in your dock.
- **Other prompts:** chain response (Mandatory/Optional, a list of options, Pass); position choice; select cards (min/max, with Confirm); tribute; place a card in a zone (empty legal zones glow); order; counters; announce card (name search); yes/no; select option.
- **Chain:** numbered links (highest resolves first), each with the card, its owner, and a short effect text.
- **Events you can animate:** summon, set, activate, chain resolving, resolved, negated, chain end, attack, phase change, LP change. Also design for damage, destroy, and "sent to GY", which the engine can report.
- **Inspector:** full art, name, Level/Rank/Link, type, attribute, ATK/DEF, card text, counters and materials. GY, Banished, and Extra piles open a pile grid.
- **Log:** a list of text lines, some private to one player.
- **Header today:** app name, format ("Domain · 1v1"), connection (Live), Sound, Motion, and a settings gear (Options: settings summary, invite, sound, motion, surrender).
- **Spectators:** see both hands hidden and get no prompts.
- Missing today, and welcome in a concept: a whose-turn indicator, attack arrows, damage and destroy feedback, chain art, ATK/DEF modified from base, and chain stop/auto-pass settings.

## The demo duel (use EXACTLY this, so the concepts compare fairly)

Domain 1v1, Master Rule 5. Turn 3; it is YOUR turn. You are "Sulman" and the opponent is "Practice Bot". Turn timer 240 s: yours 3:12, the opponent's 3:58.
Card art is in `designs/duel-ui/concepts/assets/cards/<passcode>.jpg`. Card backs: `assets/card-back-main-hd.webp` (Main Deck) and `assets/card-back-extra-hd.webp` (Extra Deck). The files are large, so scale them down with CSS.

| Card | Passcode | Facts |
|---|---|---|
| Dark Magician | 46986414 | YOUR Deck Master. DARK Spellcaster, Normal Monster, Level 7, ATK 2500 / DEF 2100 |
| Blue-Eyes White Dragon | 89631139 | OPPONENT Deck Master. LIGHT Dragon, Normal Monster, Level 8, ATK 3000 / DEF 2500 |
| Celtic Guardian | 91152256 | EARTH Warrior, Normal, Level 4, 1400 / 1200 |
| Beaver Warrior | 32452818 | EARTH Beast-Warrior, Normal, Level 4, 1200 / 1500 |
| Silver Fang | 90357090 | EARTH Beast, Normal, Level 3, 1200 / 800 |
| Battle Ox | 5053103 | EARTH Beast-Warrior, Normal, Level 4, 1700 / 1000 |
| Fissure | 66788016 | Normal Spell: destroy the 1 face-up monster your opponent controls that has the lowest ATK |
| Trap Hole | 4206964 | Normal Trap: when your opponent Normal or Flip Summons a monster with 1000 or more ATK, target it; destroy it |
| Book of Moon | 14087893 | Quick-Play Spell: target 1 face-up monster on the field; change it to face-down Defense Position |
| Solemn Judgment | 41420027 | Counter Trap: when a monster would be Summoned, OR a Spell/Trap Card is activated, pay half your LP; negate the Summon or activation, and destroy that card |
| Stardust Dragon | 44508094 | Extra Deck example art only (Synchro), optional |

Do not write any other card text. Use only the facts above.

**Start of the demo (Turn 3, Main Phase 1):**
- You: LP 8000. Hand: Celtic Guardian, Beaver Warrior, Fissure, Trap Hole, Silver Fang. Your S/T 2 holds a face-down card (it is Solemn Judgment). Deck 33, Extra 15, GY 0, Banished 0. Deck Master Dark Magician is in the Deck Master Zone: Returns 0, Next surcharge 0 LP.
- Opponent: LP 8000. Hand 5 (backs). Battle Ox in Attack Position in their centre Main Monster Zone. One face-down card in their S/T 2 (it is Book of Moon). Deck 32, Extra 15. Deck Master Blue-Eyes White Dragon is in the Deck Master Zone: Returns 0, Next surcharge 0 LP.

**States.** Each must be reachable by URL hash, e.g. `index.html#battle`. Add `?still` to render the settled end frame with no running animation, for screenshots.

1. `#m1` — **Main Phase 1, choosing an action.** Celtic Guardian is selected in hand. Its anchored menu shows Normal Summon and Set. The inspector shows Celtic Guardian. Your Deck Master dock shows a legal "Special Summon" action for Dark Magician. Legal cards are marked, and not only by color.
2. `#summon` — **Cinematic: Deck Master summon.** Celtic Guardian is already on your MZ 2 (face-up Attack). Dark Magician is Special Summoned from your Deck Master Zone to your centre MZ 3. This is the signature moment: 1.2 s max, skippable. The dock status changes to "On field". Hand is now 4 cards.
3. `#battle` — **Battle Phase, declaring an attack.** Dark Magician is selected as the attacker. The legal target, Battle Ox, is marked. The attack path is drawn. A preview shows the outcome before commit: "2500 vs 1700 · Battle Ox is destroyed · Practice Bot takes 800". There is no direct attack, because the opponent controls a monster.
4. `#chain` — **Response window.** In response to the attack, the opponent activated Book of Moon (Chain Link 1), targeting Dark Magician. You now have an OPTIONAL response: your set Solemn Judgment — "Pay half your LP (4000) to negate Book of Moon". Activate / Pass, with a response timer. The chain stack must be readable, with art.
5. `#damage` — **Resolution.** You activated Solemn Judgment (Chain Link 2). Link 2 resolves: your LP 8000 → 4000 (paid), and Book of Moon is negated and destroyed. Link 1 does nothing. The attack continues: Battle Ox is destroyed and the opponent's LP goes 8000 → 7200. Show the LP changes as the big moment they are. Solemn Judgment, Book of Moon, and Battle Ox are now in the GYs.
6. `#m2` — **Main Phase 2, placing a card.** You set Trap Hole: the legal empty S/T zones are marked, and you choose one. Hand becomes Beaver Warrior, Fissure, Silver Fang.
7. `#end` — **End Phase, turn handoff.** Your turn ends. The board clearly hands control to Practice Bot: whose turn, the timer, and your controls go quiet. The next turn is "Turn 4 · Practice Bot".

## Deliverables per concept (in `designs/duel-ui/concepts/<slug>/`)

- `index.html` — the prototype. Inline CSS/JS, or split files inside the folder. Google Fonts are allowed. three.js is allowed through an importmap from `https://cdn.jsdelivr.net/npm/three@0.170.0/...`.
- The states above, hash-addressable, plus:
  - a **Play demo** walkthrough that runs `#m1` → `#end` with real transitions;
  - a small storyboard switcher (keys 1–7 and a compact strip). It must be clearly outside the product UI, e.g. a discreet dev strip at the very top edge that can be hidden with `H`.
- Real responsive layouts: desktop at 1440×900 and 1920×1080, and mobile at 390×844. No horizontal page scroll on mobile. The whole board must be visible without scrolling on both.
- `CONCEPT.md` (max ~400 words): thesis; first viewport; signature interaction; motion grammar; how each of the 7 states works; the mobile adaptation; honest risks; and what it would take to build in the real Next.js/React app (`packages/web/src/components/duel/`).
- `shots/` — screenshots made with the helper below: `desktop-<state>.png` (1440×900) and `mobile-<state>.png` (390×844) for all 7 states, and `desktop-wide-m1.png` (1920×1080).

**Screenshot helper:**
```
CH=~/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome
$CH --headless=new --no-sandbox --use-angle=swiftshader --enable-unsafe-swiftshader --hide-scrollbars \
  --window-size=1440,900 --virtual-time-budget=4000 \
  --screenshot=OUT.png "file:///ABS/PATH/index.html?still#battle"
```
Use `--force-device-scale-factor=2` only if you need a detail check. Look at the screenshots yourself with the Read tool. Do at most two fix rounds; do not loop.

## Craft rules

- Read `.claude/skills/impeccable/reference/craft-floor.md` before building, and follow it. It has absolute bans: no eyebrow/kicker labels, no gradient text, no glass decoration, no emoji icons, and no border-left accent stripes.
- Icons are authored inline SVG in one consistent stroke weight.
- Fonts come from Google Fonts. Choose a face whose character matches the Obsidian reference: compact, light, crisp. Numerals must be tabular for LP, ATK/DEF, and timers.
- Contrast: text ≥ 4.5:1. Keyboard focus is visible on cards, menus, and prompts. Color is never the only signal.
- Theme the browser surfaces too: scrollbars, selection, focus rings.
- Do NOT edit anything outside your concept folder. Do not touch app code.
