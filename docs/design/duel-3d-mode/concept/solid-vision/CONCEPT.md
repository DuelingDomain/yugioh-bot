# B — Solid Vision

**Thesis.** The field is a duel-disk projection. Cards lie flat and readable on an obsidian table tilted 15° (8° on mobile, 0° with **Flat**). At big moments a three.js layer projects light above the table, then leaves. The DOM board stays the truth.

**First viewport.** Whose-turn pill in the header, inspector left, Deck Master docks right, the tilted Nexus table centre, untilted hands, and a phase bar that names its owner and marks offered phases.

**Signature.** `#summon`: Dark Magician flies from your dock, gold rings form in MZ 3, a purple cone lifts, and the art builds as a scanline hologram, then settles into the card (1.15 s). Click, Space or Esc skips. Options add "Summon cut-in: once per duel".

**Motion grammar.** Gold is the projector. Purple is yours and active. Ember is opponent ownership. Red is damage only. The render loop runs only during a moment (DPR cap 2), and clocks pause.

**States.**
1. `#m1`: Celtic Guardian lifted, anchored Normal Summon / Set menu, legal cards with a chevron tab, dock offers Special Summon.
2. `#summon`: the signature; dock reads "On field"; hand 4.
3. `#battle`: gold 3D arc, ringed and labelled attacker and target, the exact outcome preview. Drag or click to attack.
4. `#chain`: projected tiles with art and link numbers (also badged on cards). Link 2 is the pending Solemn response with countdown, LP 8000→4000, Activate / Pass.
5. `#damage`: cost roll, negation, shatter, damage roll. Cost (gold, "cost") and damage (red, "damage") differ by colour, icon and word.
6. `#m2`: empty S/T zones marked; a Trap Hole ghost follows hover.
7. `#end`: your side powers down, light moves to the opponent, "Turn 4 · Practice Bot" banner.

**`?still`.** `#summon` and `#damage` show the projection at its **peak** (hologram risen; shards mid-flight with final LP). The others are settled. `?nogl` forces the CSS fallback; `?demo` autoplays.

**Mobile.** Chips replace docks, the inspector becomes a peek bar plus sheet, and chain and preview dock as bottom sheets. The whole board fits 390×844.

**Risks.** Phone zones are about 50 px. 15° is the tilt limit for the far row. The real app needs CORS card textures (the prototype embeds two data-URI textures because `file://` images cannot feed WebGL).

**To build.** A `DuelTable` (CSS 3D, no overflow, opacity or filter on the tilted node), one on-demand `ProjectionCanvas`, and overlays anchored with `getBoundingClientRect`. About 2–3 weeks.
