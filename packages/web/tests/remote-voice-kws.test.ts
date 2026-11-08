import { describe, expect, it } from "vitest";
import { parsePhaseCommand, remoteActionSchema, ygoModule, type RemoteState } from "@yugidraft/shared/remote";
import { canFlipSummon, interpret } from "@/components/remote/ui/grammar";
import { buildMatcher } from "@/components/remote/ui/voice/speech-matcher";
import { createSentencePiece, type SentencePieceVocab } from "@/components/remote/ui/voice/sentencepiece";
import { buildPhrases, combineHits, FIXED_PHRASES, isChatter, spokenForm } from "@/components/remote/ui/voice/phrases";
import { heardPhaseOf, judgePhaseWord } from "@/components/remote/ui/voice/phase-plausibility";
import vocab from "@/components/remote/ui/voice/sp-vocab.json";

const sp = createSentencePiece(vocab as SentencePieceVocab);

// Reference output of `sherpa-onnx-cli text2token --tokens-type bpe` for the gigaspeech KWS model (the vocabulary is a unigram LM:
// a greedy longest match gives "▁LIGHT ▁UP" for the first line, the model gives "▁ L IGHT ▁UP").
const GOLDEN: [string, string][] = [
  ["LIGHT UP", "\u2581 L IGHT \u2581UP"],
  ["HELLO WORLD", "\u2581HE LL O \u2581WORLD"],
  ["BATTLE PHASE", "\u2581BA T T LE \u2581PH AS E"],
  ["MAIN TWO", "\u2581MA IN \u2581TWO"],
  ["MAIN PHASE ONE", "\u2581MA IN \u2581PH AS E \u2581ONE"],
  ["END TURN", "\u2581EN D \u2581TURN"],
  ["STANDBY PHASE", "\u2581STA ND B Y \u2581PH AS E"],
  ["DRAW PHASE", "\u2581DR A W \u2581PH AS E"],
  ["ATTACK WITH", "\u2581AT TA CK \u2581WITH"],
  ["ACTIVATE EFFECT", "\u2581 ACT IV ATE \u2581E FF E C T"],
  ["KASHTIRA", "\u2581K A SH TI RA"],
  ["APOPHIS", "\u2581A PO PH IS"],
  ["KURIBOH", "\u2581K U RI B O H"],
  ["BLUE EYES WHITE DRAGON", "\u2581B LU E \u2581E Y ES \u2581WHITE \u2581DR A G ON"],
  ["DARK MAGICIAN", "\u2581DA R K \u2581MA G IC IAN"],
  ["GHOST BELLE AND HAUNTED MANSION", "\u2581G HO S T \u2581BE LL E \u2581AND \u2581HA UN TED \u2581MAN S ION"],
  ["ASH BLOSSOM AND JOY SPRING", "\u2581A SH \u2581B LO S S OM \u2581AND \u2581JO Y \u2581SP R ING"],
  ["MAGICIAN'S ROD", "\u2581MA G IC IAN ' S \u2581RO D"],
  ["NUMBER THIRTY NINE UTOPIA", "\u2581NUMBER \u2581TH IR TY \u2581NINE \u2581 U T O P IA"],
  ["SANGAN", "\u2581SA NG AN"],
  ["DROLL AND LOCK BIRD", "\u2581DR O LL \u2581AND \u2581LO CK \u2581B IR D"],
  ["FENRIR", "\u2581F EN RI R"],
  ["EXODIA THE FORBIDDEN ONE", "\u2581EX O D IA \u2581THE \u2581FOR B ID D EN \u2581ONE"],
  ["MAXX C", "\u2581MA X X \u2581C"],
  ["UNDO THAT", "\u2581UN D O \u2581THAT"],
  ["NEXT PHASE", "\u2581NEXT \u2581PH AS E"],
  ["GO BACK A PHASE", "\u2581GO \u2581BACK \u2581A \u2581PH AS E"],
  ["PHASE", "\u2581PH AS E"],
  ["ONE", "\u2581ONE"],
  ["TWO", "\u2581TWO"],
  ["SUMMON", "\u2581SU M M ON"]
];

describe("browser voice commands (KWS)", () => {
  it("encodes like sentencepiece (golden text2token)", () => {
    for (const [text, tokens] of GOLDEN) expect(sp.encode(text).join(" "), text).toBe(tokens);
  });

  it("builds tagged phrases whose canonical text the parser accepts", () => {
    const set = buildPhrases(["Kashtira Fenrir", "Kashtira Unicorn", "Apophis the Dark", "Number 39: Utopia"], sp);
    expect(set.counts.skipped).toEqual([]);
    expect(spokenForm("Number 39: Utopia")).toBe("NUMBER THIRTY NINE UTOPIA");
    const tagOf = (spoken: string) => [...set.meanings].find(([, meaning]) => meaning.spoken.toUpperCase() === spoken)?.[0];
    expect(tagOf("APOPHIS")).toBeTruthy();
    expect(tagOf("MAN")).toBeUndefined();
    const kashtira = set.meanings.get(tagOf("KASHTIRA")!);
    expect(kashtira).toMatchObject({ kind: "card" });
    expect((kashtira as { names: string[] }).names).toHaveLength(2);
    // Battle is not allowed on the first turn of a two-player duel.
    const state = { ...ygoModule.initialState({ seatCount: 2 }), turn: 2 };
    const phases = [["BATTLE", "battle phase"], ["MAIN", "main phase"], ["END", "end phase"], ["DRAW PHASE", "draw phase"], ["STANDBY", "standby phase"]];
    for (const [spoken, canonical] of phases) {
      expect(FIXED_PHRASES.find(([said]) => said === spoken)?.[1]).toBe(canonical);
      expect(parsePhaseCommand(canonical, state as RemoteState), canonical).not.toBeNull();
    }
    const fixed = (spoken: string) => ({ keyword: tagOf(spoken)! });
    expect(combineHits([fixed("MAIN"), fixed("TWO")], set.meanings).canonical).toBe("main phase two");
    expect(combineHits([fixed("END"), fixed("TURN")], set.meanings).canonical).toBe("end turn");
    expect(combineHits([fixed("BATTLE"), fixed("PHASE")], set.meanings).canonical).toBe("battle phase");
    expect(combineHits([fixed("DRAW")], set.meanings).canonical).toBe("draw");
    expect(combineHits([fixed("PASS")], set.meanings).canonical).toBe("end turn");
    // A verb and one card, in either order; a partial shared by two cards stays ambiguous.
    expect(combineHits([fixed("EFFECT OF"), fixed("UTOPIA")], set.meanings).canonical).toBe("activate effect of Number 39: Utopia");
    expect(combineHits([fixed("UTOPIA"), fixed("EFFECT")], set.meanings).canonical).toBe("activate effect of Number 39: Utopia");
    expect(combineHits([fixed("KASHTIRA")], set.meanings).ambiguous[0].names).toEqual(["Kashtira Fenrir", "Kashtira Unicorn"]);
    expect(combineHits([fixed("KASHTIRA"), fixed("FENRIR")], set.meanings).canonical).toBe("Kashtira Fenrir");
  });

  it("accepts a spoken phase only as the next phase or a legal skip, from the turn player", () => {
    const verdict = (...args: Parameters<typeof judgePhaseWord>) => { const v = judgePhaseWord(...args); return v.accept ? (v.move.kind === "turn" ? "turn" : v.move.phase) : v.reason; };
    expect(verdict("draw", 2, true, "standby")).toBe("standby");
    expect(verdict("standby", 2, true, "main")).toBe("main1");
    expect(verdict("main1", 2, true, "end")).toBe("end");
    expect(verdict("battle", 2, true, "main")).toBe("main2");
    expect(verdict("end", 2, true, "endTurn")).toBe("turn");
    expect(verdict("main2", 2, true, "endTurn")).toBe("turn");
    expect(verdict("standby", 2, true, "endTurn")).toBe("too early to end the turn");
    expect(verdict("main1", 2, true, "draw")).toBe("not a next phase");
    expect(verdict("main1", 2, true, "main1")).toBe("already in Main 1");
    expect(verdict("draw", 2, true, "battle")).toBe("skips too far");
    expect(verdict("main1", 1, true, "battle")).toBe("no Battle Phase this turn");
    expect(verdict("main1", 2, false, "battle")).toBe("not your turn");
    expect(heardPhaseOf("main phase two")).toBe("main2");
    expect(heardPhaseOf("draw")).toBeNull();
  });

  // The common duel phrases (owner request 2026-11-08): what players really say, mapped to actions the table already has.
  describe("common duel phrases", () => {
    const place = (state: RemoteState, seat: number, ref: string, name: string, slot: number) => ygoModule.reduce(state, remoteActionSchema.parse({
      type: "twin.place", actorSeat: seat, seat, zone: "monster", at: 1000 + slot + seat * 10, idempotencyKey: `fx-${ref}`, card: { ref, name, slot, faceUp: true, position: "attack" } }));
    const board = (phase: string, turnSeat = 0) => {
      let state = { ...ygoModule.initialState({ seatCount: 2 }), turn: 2, phase, turnSeat } as RemoteState;
      state = place(state, 0, "a", "Blue-Eyes White Dragon", 1);
      return place(state, 1, "b", "Dark Magician", 1);
    };
    const players = [{ seat: 0, displayName: "Me" }, { seat: 1, displayName: "Opponent" }];
    const said = (text: string, phase = "main1", me = 0, extra: Partial<RemoteState> = {}) => {
      const intent = interpret(text, { state: { ...board(phase), ...extra }, players, me, trayOpen: false, cardNames: ["Blue-Eyes White Dragon", "Dark Magician"], now: 5000 });
      return intent.kind === "phase" ? `phase ${intent.phase}` : intent.kind === "move" ? `move ${JSON.stringify(intent.move)}` : intent.kind;
    };

    it("maps spoken phrases to existing actions, and ignores the same words in talk", () => {
      const cases: [string, string, string?][] = [
        ["pass turn", "turn"], ["I pass", "turn"], ["I'll pass", "turn"], ["pass", "turn"], ["end my turn", "turn"], ["turn end", "turn"],
        ["that's my turn", "turn"], ["your turn", "turn"], ["your go", "turn"],
        ["going to battle", "phase battle"], ["into battle", "phase battle"], ["enter battle", "phase battle"], ["go to battle", "phase battle"], ["moving to end phase", "phase end"],
        ["main two", "phase main2", "battle"], ["main phase one", "phase main1", "standby"], ["next phase", "phase battle"], ["standby", "phase standby", "draw"], ["battle phase", "phase battle"],
        // The explicit forms use the same rule: a phase that is not a legal next phase is ignored, and "back to" is the way to correct.
        ["main phase one", "none", "main2"], ["end phase", "none", "draw"], ["draw phase", "none", "end"], ["battle phase", "none", "main2"], ["back to main phase one", "phase main1", "main2"],
        // A card type is not a card name: it must not reach the fuzzy name match (Monster Reborn).
        ["set a monster face down", "none"], ["set a spell face down", "none"], ["set a trap", "none"], ["set Monster Reborn face down", "move {\"query\":\"monster reborn\",\"faceUp\":false}"],
        ["swing at Dark Magician", "attack"], ["swing", "attack"], ["Blue-Eyes White Dragon swings at Dark Magician", "attack"], ["I attack with Blue-Eyes White Dragon", "attack"],
        ["Blue-Eyes White Dragon attacks Dark Magician", "attack"], ["attack directly", "attack"], ["direct attack", "attack"], ["go direct", "attack"],
        ["chain", "wake"], ["I chain", "wake"], ["in response", "wake"], ["respond", "wake"],
        ["set", "move {\"faceUp\":false}"], ["set a card", "move {\"faceUp\":false}"], ["I set one face down", "move {\"faceUp\":false}"],
        ["flip summon Blue-Eyes White Dragon", "move {\"query\":\"blue eyes white dragon\",\"position\":\"attack\",\"faceUp\":true,\"flipSummon\":true}"],
        // m1 and m2 are always Monster Zone 1 and 2, never a phase.
        ["m1", "move {\"dest\":{\"zone\":\"monster\",\"slot\":1}}"], ["m2", "move {\"dest\":{\"zone\":\"monster\",\"slot\":2}}"],
        // A bare flip summon, and a set by card type, would act on whatever card was touched last, so they do nothing.
        ["flip summon", "none"], ["I set a trap", "none"], ["go ahead", "none"],
        // Words with no action yet, and the same words inside ordinary talk, do nothing.
        ["no response", "none"], ["no chain", "none"], ["resolve", "none"], ["okay", "none"], ["go", "none"],
        ["normal summon", "none"], ["summon", "none"], ["tribute summon", "none"], ["special summon", "none"], ["I set two face down", "none"],
        ["go ahead and play it", "none"], ["your turn is next", "none"], ["I was going to battle last turn", "none"], ["swing of memories", "none"], ["so I pass priority to you", "none"],
      ];
      for (const [text, expected, phase] of cases) expect(said(text, phase), text).toBe(expected);
      // A phase word that is not a next phase is still ignored by the voice rule, and the soft turn phrases need your own turn from Main 1 on.
      expect(said("your turn", "standby")).toBe("none");
      expect(said("I pass", "draw")).toBe("none");
      expect(said("I'll pass", "main1", 1)).toBe("none");
      // Spoken phases go through the same plausibility rule as the voice check page (the live table has no other check).
      expect(said("em one", "main2")).toBe("none");
      expect(said("em two", "end")).toBe("none");
      expect(said("into battle", "main2")).toBe("none");
      expect(said("going to the end", "main1")).toBe("none");
      expect(said("m1", "draw")).toBe("move {\"dest\":{\"zone\":\"monster\",\"slot\":1}}");
      expect(said("em two", "battle")).toBe("phase main2");
      expect(said("m two", "battle")).toBe("phase main2");
      expect(said("em one", "standby")).toBe("phase main1");
      // A pending attack keeps its confirm chip: a spoken pass does not replace it.
      const attacking = { attack: { id: "x", attackerSeat: 0, targetSeat: 1, direct: true } };
      expect(said("pass turn", "main1", 0, attacking)).toBe("none");
      expect(said("I pass", "main1", 0, attacking)).toBe("none");
      expect(canFlipSummon({ zone: "monster", faceUp: false })).toBe(true);
      expect(canFlipSummon({ zone: "spell-trap", faceUp: false })).toBe(false);
      expect(canFlipSummon({ zone: "monster", faceUp: true })).toBe(false);
      expect(judgePhaseWord("main1", 2, true, heardPhaseOf("main phase one")!)).toMatchObject({ accept: false });
    });

    it("keyword spotter: every phrase can be encoded, joins up, and soft phrases need a short utterance", () => {
      const set = buildPhrases(["Dark Magician"], sp);
      expect(set.counts.skipped).toEqual([]);
      const hit = (spoken: string) => ({ keyword: [...set.meanings].find(([, meaning]) => meaning.kind !== "card" && meaning.spoken === spoken)![0] });
      const canonical = (...spoken: string[]) => combineHits(spoken.map(hit), set.meanings).canonical;
      expect(canonical("PASS", "TURN")).toBe("end turn");
      expect(canonical("GOING TO BATTLE")).toBe("battle phase");
      expect(canonical("EM TWO")).toBe("main phase two");
      expect(canonical("SWING AT")).toBe("attack");
      expect(canonical("I CHAIN")).toBe("chain");
      const iPass = combineHits([hit("I PASS")], set.meanings);
      expect(isChatter(iPass, set.meanings, 900)).toBe(false);
      expect(isChatter(iPass, set.meanings, 3000)).toBe(true);
      expect(isChatter(combineHits([hit("GO TO BATTLE")], set.meanings), set.meanings, 3000)).toBe(false);
    });

    it("speech model matcher: the same phrases from a transcript, and no match on chatter", () => {
      const matcher = buildMatcher(["Dark Magician"]);
      const heard = (text: string, ms = 900) => matcher.match(text, ms).canonical;
      expect(heard("Pass turn.")).toBe("end turn");
      expect(heard("Your go.")).toBe("end turn");
      expect(heard("Going to battle")).toBe("battle phase");
      expect(heard("M2")).toBe("main phase two");
      expect(heard("Swing")).toBe("attack");
      expect(heard("In response")).toBe("chain");
      expect(heard("I set one face down")).toBe("set");
      expect(heard("I pass", 3000)).toBe("");
      expect(heard("Go ahead")).toBe("");
      expect(heard("so then he went ahead and passed the turn to me")).toBe("");
      expect(heard("no response")).toBe("");
      expect(heard("no chain")).toBe("");
    });
  });
});
