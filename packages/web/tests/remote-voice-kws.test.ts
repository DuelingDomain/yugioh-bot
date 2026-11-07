import { describe, expect, it } from "vitest";
import { parsePhaseCommand, ygoModule, type RemoteState } from "@yugidraft/shared/remote";
import { createSentencePiece, type SentencePieceVocab } from "@/components/remote/ui/voice/sentencepiece";
import { buildPhrases, combineHits, FIXED_PHRASES, spokenForm } from "@/components/remote/ui/voice/phrases";
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
});
