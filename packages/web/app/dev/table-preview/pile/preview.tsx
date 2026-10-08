"use client";

import { useMemo, useState } from "react";
import type { DuelCard } from "@yugidraft/shared/duels";
import { LOCATION_GRAVE, TYPE_EFFECT, TYPE_MONSTER, TYPE_SPELL } from "@/components/duel/constants";
import { duelFontClasses } from "@/components/duel/fonts";
import { PileViewer } from "@/components/duel/pile-viewer";
import { useTableTextScale } from "@/components/duel/card-text-size";

const SHORT = "Once per turn: banish 1 monster your opponent controls.";
const LONG =
  "Cannot be Normal Summoned/Set. Must first be Special Summoned (from your hand) by banishing 1 LIGHT and 1 DARK monster from your GY. You can only Special Summon \"Jinzo\" once per turn. (1) Once per turn: You can target 1 monster your opponent controls; banish it. (2) If this card attacks a monster, it can make a second attack during each Battle Phase, but only against a monster. (3) If this card is banished: You can send 1 card from your hand to the GY; return this card to the field, and if you do, you can add 1 banished card of yours to your hand. (4) While this card is face-up on the field, your opponent cannot activate the effects of banished cards, and each time a card is banished, you gain 300 LP. These effects are not negated while this card is in your Monster Zone.";

const NAMES: ReadonlyArray<readonly [number, string]> = [
  [89631139, "Blue-Eyes White Dragon"], [46986414, "Dark Magician"], [74677422, "Red-Eyes Black Dragon"], [70095154, "Cyber Dragon"],
  [70781052, "Summoned Skull"], [6368038, "Gaia The Fierce Knight"], [77585513, "Jinzo"], [72989439, "Black Luster Soldier - Envoy of the Beginning"],
  [97077563, "Call of the Haunted"], [38033121, "Dark Magician Girl"], [32995007, "Celestial Wolf Lord, Blue Sirius"],
];

function pile(count: number, text: string | null): DuelCard[] {
  return Array.from({ length: Math.max(1, Math.min(40, count)) }, (_, sequence) => {
    const [code, name] = NAMES[sequence % NAMES.length];
    const spell = code === 97077563;
    return {
      controller: 0, location: LOCATION_GRAVE, sequence, position: 1, code,
      // The last card is the top of the pile: the long Jinzo text, as in the owner's report.
      name: text === "none" ? undefined : sequence === count - 1 ? "Red-Eyes Alternative Black Dragon" : name,
      description: text === "none" ? undefined : text === "short" || sequence % 2 ? SHORT : LONG,
      type: spell ? TYPE_SPELL : TYPE_MONSTER | TYPE_EFFECT, attack: spell ? 0 : 2400, defense: spell ? 0 : 2000, level: spell ? 0 : 7, attribute: 32, race: spell ? "" : "Dragon",
    };
  });
}

/** The pile viewer alone on a board-sized box (`box` = the box height in px, else the window), for the screenshots of every size. */
export function PilePreview({ count, text, owner, reduced, box }: { count: number; text: string | null; owner: "you" | "opp"; reduced: boolean; box: number | null }) {
  useTableTextScale();
  const cards = useMemo(() => pile(count, text), [count, text]);
  const [open, setOpen] = useState(true);
  return (
    <div className={duelFontClasses} style={{ position: "relative", height: box ? `${box}px` : "100dvh", background: "#070b15" }}>
      {open ? null : <button type="button" onClick={() => setOpen(true)} style={{ margin: 16, color: "#efe7d5" }}>Open Graveyard</button>}
      <PileViewer title={owner === "you" ? "Your Graveyard" : "Opponent Graveyard"} cards={cards} owner={owner} open={open} onClose={() => setOpen(false)}
        onInspectCard={() => {}} reducedMotion={reduced} />
    </div>
  );
}
