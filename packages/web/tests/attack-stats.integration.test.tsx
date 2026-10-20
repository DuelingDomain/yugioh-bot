import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { DuelCard } from "@yugidraft/shared/duels";
import { oddEyesAtSummonWindow } from "../../duel-server/tests/support/attack-stats";
import { describeWithCores, needs } from "../../duel-server/tests/support/cores";
import { CardInspector } from "../src/components/duel/inspector";
import { cardFieldStats } from "../src/components/duel/card-face";
import { cardCombatText } from "../src/components/duel/constants";
import { buildAttackPreview } from "../src/components/duel/solid/attack-preview";


function Stats({ card }: { card: DuelCard }) {
  return <><CardInspector target={{ type: "card", card }} />
    <p data-testid="field-stats">{cardFieldStats(card, true)}</p>
    <p data-testid="hand-stats">{cardCombatText({ ...card, location: 2 })}</p></>;
}

for (const [format, legacy] of [["1v1", false], ["1v1", true], ["ffa3", false], ["ffa4", false], ["tag", false]] as const) {
  describeWithCores(`real engine ATK display (${format}, ${legacy ? "legacy" : "pinned"})`,
    [needs.cards(), needs.scripts(), ...(format === "1v1" ? [needs.standard()] : [needs.installedMulti()])], () => {
      it("renders ? during summon and the effect's live value once the summon finishes", async () => {
        const game = await oddEyesAtSummonWindow(format, legacy);
        try {
          const view = game.view(0);
          const card = view.seats[0].monsters[0]!;
          expect(card.attack).toBe(-2);
          const markup = renderToStaticMarkup(<Stats card={card} />);
          expect(markup).toContain("ATK ? / DEF ?");
          expect(markup).toContain('data-testid="field-stats">? / ?</p>');
          expect(markup).toContain('data-testid="hand-stats">ATK ? / DEF ?</p>');
          // No damage prediction may treat an unresolved ? as a negative attack value.
          expect(buildAttackPreview(view, "0:4:0", "1:4:0", seat => `Player ${seat + 1}`)).toBeUndefined();
          const prompt = game.view(1).prompt!;
          game.answer(1, prompt.id, { cancel: true });
          const after = renderToStaticMarkup(<Stats card={game.view(0).seats[0].monsters[0]!} />);
          const attack = game.view(0).seats[1].lp / 2;
          expect(after).toContain(`ATK ${attack} / DEF ${attack}`);
          expect(after).toContain(`data-testid="field-stats">${attack} / ${attack}</p>`);
          expect(buildAttackPreview(game.view(0), "0:4:0", "1:4:0", seat => `Player ${seat + 1}`))
            .toMatchObject({ attacker: String(attack), target: "800" });
        } finally { game.close(); }
      });

      it("renders old replay snapshots with unsigned ? and clamps other negative stats", async () => {
        const game = await oddEyesAtSummonWindow(format, legacy);
        try {
          const card = game.view(0).seats[0].monsters[0]!;
          // Older saved frames may have persisted the decoder's unsigned representation.
          const replayCard = JSON.parse(JSON.stringify({ ...card, attack: card.attack! >>> 0, defense: card.defense! >>> 0 })) as DuelCard;
          const markup = renderToStaticMarkup(<Stats card={replayCard} />);
          expect(markup).toContain("ATK ? / DEF ?");
          expect(markup).toContain('data-testid="field-stats">? / ?</p>');
          const clamped = renderToStaticMarkup(<Stats card={{ ...card, attack: -500, defense: -1 }} />);
          expect(clamped).toContain("ATK 0 / DEF 0");
          expect(clamped).toContain('data-testid="field-stats">0 / 0</p>');
          const unsignedNegative = renderToStaticMarkup(<Stats card={{ ...card, attack: -500 >>> 0, defense: -1 >>> 0 }} />);
          expect(unsignedNegative).toContain("ATK 0 / DEF 0");
        } finally { game.close(); }
      });
    });
}
