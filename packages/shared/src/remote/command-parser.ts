import { remoteActionSchema, type RemoteActionProposal } from "./actions.js";
import type { GameModule } from "./types.js";

const fold = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const zones: Record<string, string> = { monster: "monster", "extra monster": "extra-monster", "spell trap": "spell-trap", field: "field", graveyard: "graveyard", banished: "banished" };
const phases: Record<string, string> = { draw: "draw", standby: "standby", "main 1": "main1", "main one": "main1", battle: "battle", "main 2": "main2", "main two": "main2", end: "end" };

/** Small explicit speech grammar. Produces proposals only; the reducer remains authoritative. */
export const parseRemoteCommand: GameModule["parseCommand"] = ({ text, actorSeat, state }) => {
  const seat = state.seats.find(s => s.seat === actorSeat);
  if (!seat || text.length > 500) return null;
  const raw = text.trim().replace(/[.!?]+$/, ""); const words = fold(raw);
  let proposal: RemoteActionProposal | null = null;
  if (words === "undo" && state.undo) proposal = { type: "undo", actorSeat, targetActionId: state.undo.actionId };
  if (words === "next phase") proposal = { type: "phase.advance", actorSeat };
  if (words === "end turn") proposal = { type: "turn.end", actorSeat };
  if (words === "concede") proposal = { type: "player.concede", actorSeat };
  const phase = words.replace(/^(?:set phase to |set phase |phase )/, "").replace(/ phase$/, "");
  if (phases[phase]) proposal = { type: "phase.set", actorSeat, phase: phases[phase] };
  const lp = words.match(/^(lose|gain|set lp to) (\d+)(?: lp| life points)?$/);
  if (lp) {
    const amount = Number(lp[2]);
    const delta = lp[1] === "set lp to" ? amount - seat.resources.lp : amount * (lp[1] === "lose" ? -1 : 1);
    proposal = { type: "lp.change", actorSeat, seat: actorSeat, delta, reason: "Voice adjustment" };
  }
  if (words === "resolve attack" || words === "cancel attack") {
    if (state.attack) proposal = { type: "attack.resolve", actorSeat, attackId: state.attack.id, outcome: words === "resolve attack" ? "resolved" : "cancelled" };
  }
  const identified = words.match(/^identify (\d{1,10})$/);
  if (identified) proposal = { type: "card.identified", actorSeat, seat: actorSeat, cardId: Number(identified[1]), source: "voice" };
  if (/^note /i.test(raw)) proposal = { type: "log.note", actorSeat, text: raw.slice(5).trim() };
  const place = raw.match(/^(?:place|add|summon) (.+?) (?:in|to) (extra[- ]monster|monster|spell[- /]trap|field|graveyard|banished)(?: (?:slot|zone) ([1-5]))?$/i);
  if (place) {
    let n = 1; while (seat.twin.some(c => c.ref === `voice-${actorSeat}-${n}`)) n++;
    proposal = { type: "twin.place", actorSeat, seat: actorSeat, zone: zones[fold(place[2])], card: {
      ref: `voice-${actorSeat}-${n}`, name: place[1].trim(), faceUp: true, position: "attack", ...(place[3] ? { slot: Number(place[3]) } : {}),
    } };
  }
  const edit = raw.match(/^(flip|move|remove) (.+?)(?: face (up|down)| to (extra[- ]monster|monster|spell[- /]trap|field|graveyard|banished)(?: (?:slot|zone) ([1-5]))?)?$/i);
  if (edit) {
    const query = fold(edit[2]); const slot = query.match(/^(?:slot|zone) ([1-5])$/);
    const cards = seat.twin.filter(c => slot ? c.slot === Number(slot[1]) : fold(c.ref) === query || fold(c.name ?? "") === query);
    if (cards.length !== 1) return null;
    const cardRef = cards[0].ref;
    if (edit[1].toLowerCase() === "remove") proposal = { type: "twin.remove", actorSeat, seat: actorSeat, cardRef };
    if (edit[1].toLowerCase() === "flip" && edit[3]) proposal = { type: "twin.flip", actorSeat, seat: actorSeat, cardRef, faceUp: edit[3].toLowerCase() === "up" };
    if (edit[1].toLowerCase() === "move" && edit[4]) proposal = { type: "twin.move", actorSeat, seat: actorSeat, cardRef, zone: zones[fold(edit[4])], ...(edit[5] ? { slot: Number(edit[5]) } : {}) };
  }
  return proposal && remoteActionSchema.safeParse({ ...proposal, idempotencyKey: "proposal" }).success ? proposal : null;
};
