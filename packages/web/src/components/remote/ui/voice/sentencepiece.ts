/**
 * SentencePiece unigram encoder for the sherpa-onnx KWS model (gigaspeech BPE-500 vocabulary).
 *
 * The model file says "BPE" but the trainer is a unigram LM: the split is the Viterbi path with the best summed score,
 * not a greedy longest match ("LIGHT UP" is `▁ L IGHT ▁UP`, a greedy match gives `▁LIGHT ▁UP`). The golden
 * checks come from `sherpa-onnx-cli text2token` (see tests/remote-voice-kws.test.ts).
 *
 * Input is upper-case letters, apostrophe and hyphen only. The vocabulary has no digits and no other punctuation.
 */
export type SentencePieceVocab = { pieces: readonly string[]; scores: readonly number[]; unk: number; first: number };

const SPACE = "▁";
const UNK_PENALTY = 10;

export type SentencePiece = { encode(text: string): string[]; readonly vocabSize: number; has(piece: string): boolean };

/** `vocab.pieces` index is the token id in tokens.txt. `first` is the index of the first normal piece (after <blk>, <sos/eos>, <unk>). */
export function createSentencePiece(vocab: SentencePieceVocab): SentencePiece {
  const ids = new Map<string, number>();
  let minScore = Infinity;
  let maxLength = 1;
  for (let id = vocab.first; id < vocab.pieces.length; id++) {
    ids.set(vocab.pieces[id], id);
    minScore = Math.min(minScore, vocab.scores[id]);
    maxLength = Math.max(maxLength, Array.from(vocab.pieces[id]).length);
  }
  const unkScore = minScore - UNK_PENALTY;

  function encode(text: string): string[] {
    // Normalization the model applies: collapse whitespace, one dummy prefix, spaces become the space mark.
    const words = text.trim().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const chars = Array.from(SPACE + words.join(SPACE));
    const n = chars.length;
    const best = new Array<number>(n + 1).fill(-Infinity);
    const from = new Array<number>(n + 1).fill(-1);
    const piece = new Array<number>(n + 1).fill(-1);
    best[0] = 0;
    for (let start = 0; start < n; start++) {
      if (best[start] === -Infinity) continue;
      let single = false;
      let candidate = "";
      for (let len = 1; len <= maxLength && start + len <= n; len++) {
        candidate += chars[start + len - 1];
        const id = ids.get(candidate);
        if (id === undefined) continue;
        if (len === 1) single = true;
        const score = best[start] + vocab.scores[id];
        // Strict ">" keeps the first path on a tie, like SentencePiece.
        if (score > best[start + len]) { best[start + len] = score; from[start + len] = start; piece[start + len] = id; }
      }
      if (!single) {
        const score = best[start] + unkScore;
        if (score > best[start + 1]) { best[start + 1] = score; from[start + 1] = start; piece[start + 1] = vocab.unk; }
      }
    }
    const out: string[] = [];
    for (let end = n; end > 0; end = from[end]) out.push(vocab.pieces[piece[end]]);
    return out.reverse();
  }
  return { encode, vocabSize: vocab.pieces.length, has: (p) => ids.has(p) };
}
