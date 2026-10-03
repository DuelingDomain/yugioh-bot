import { CARDS as C } from "./cards";
import { edit, ev, newBoard, type Edit, type EventSpec, type LabScenario } from "./board";

const hand = [C.sangan, C.kuriboh, C.potOfGreed, C.monsterReborn, C.blueEyes];
const phase = (text: string): EventSpec => ({ kind: "phase", text });

function openingDeal(id: string, viewer: number | null, game: number): LabScenario {
  const perspective = viewer == null ? "spectator" : viewer === 0 ? "first player (seat 0)" : "second player (seat 1)";
  return {
    id, category: "Card moves", name: `Opening deal: ${perspective}${game === 2 ? " · Game 2" : ""}`,
    description: `Both hands are dealt from their owners' displayed Decks before the phase ribbons. Then seat 1 takes an ordinary turn draw. View: ${perspective}${game === 2 ? ", after a Bo3 seat change" : ""}.`,
    build: () => {
      const events: EventSpec[] = [];
      const edits: Edit[] = [];
      for (const seat of [0, 1]) {
        for (const [sequence, card] of hand.entries()) {
          const shown = seat === viewer ? card : null;
          events.push(ev.draw(seat, shown, sequence));
          edits.push(edit.drawFromDeck(seat), edit.addHand(seat, shown));
        }
      }
      events.push(phase("Draw Phase"), phase("Standby Phase"), phase("Main Phase 1"));
      edits.push(edit.phase("main1", 0));
      const laterCard = viewer === 1 ? C.heavyStorm : null;
      return {
        mySeat: viewer,
        initial: newBoard({ deck: 40 }, { deck: 40 }, "", 0),
        steps: [
          { at: 0, events, edits },
          { at: 8500, events: [phase("Draw Phase"), ev.draw(1, laterCard, 5), phase("Standby Phase"), phase("Main Phase 1")],
            edits: [edit.drawFromDeck(1), edit.addHand(1, laterCard), edit.phase("main1", 1)] },
        ],
        tailMs: 6500,
        ...(game === 2 ? { series: { game: 2, wins: [1, 0] as [number, number], screen: "label" as const } } : {}),
      };
    },
  };
}

export const OPENING_DEAL_SCENARIOS: LabScenario[] = [
  openingDeal("opening-deal", 0, 1),
  openingDeal("opening-deal-seat1", 1, 1),
  openingDeal("opening-deal-spectator", null, 1),
  openingDeal("opening-deal-game2-seat0", 0, 2),
  openingDeal("opening-deal-game2-seat1", 1, 2),
  openingDeal("opening-deal-game2-spectator", null, 2),
];
