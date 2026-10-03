import { describe, expect, it } from "vitest";
import { formatFromTitle, normalizeText, rankCandidates, textSimilarity, type DuplicateCandidate } from "@/lib/bug-reports/similarity";

const issue = (number: number, title: string, extra: Partial<DuplicateCandidate> = {}): DuplicateCandidate => ({
  number, url: `https://github.com/o/r/issues/${number}`, title, text: title, ...extra,
});

describe("bug report similarity", () => {
  it("removes title tags and marks", () => {
    expect(normalizeText("[Bug] [FFA3] The chain, froze!")).toBe("the chain froze");
  });

  it("scores the same text high and unrelated text low", () => {
    expect(textSimilarity("Chain link 2 never resolves and the duel freezes", "Chain link 2 never resolves and the duel freezes")).toBeGreaterThan(0.95);
    expect(textSimilarity("Chain link 2 never resolves and the duel freezes", "Card art is blurry on my phone screen")).toBeLessThan(0.15);
    expect(textSimilarity("", "anything here")).toBe(0);
  });

  it("scores a close wording above a distant one", () => {
    const close = textSimilarity("duel freezes when the chain resolves", "[Bug] [FFA3] Duel froze while the chain was resolving");
    const far = textSimilarity("duel freezes when the chain resolves", "Deck editor drops the extra deck cards");
    expect(close).toBeGreaterThan(far);
    expect(close).toBeGreaterThan(0.3);
  });

  it("reads the format from a title tag", () => {
    expect(formatFromTitle("[Bug] [FFA3] x")).toBe("ffa3");
    expect(formatFromTitle("[Bug] [Tag] x")).toBe("tag");
    expect(formatFromTitle("[Bug] x")).toBeUndefined();
  });

  it("ranks the best match first, drops weak ones and keeps at most 3", () => {
    const query = { text: "the duel freezes when the chain resolves on my turn" };
    const ranked = rankCandidates(query, [
      issue(1, "Deck editor drops extra deck cards"),
      issue(2, "[Bug] Duel freezes when the chain resolves"),
      issue(3, "Duel freezes when chain resolves on my turn"),
      issue(4, "Duel freezes when the chain resolves during my turn"),
      issue(5, "Chain resolves then duel freezes on turn"),
    ]);
    expect(ranked).toHaveLength(3);
    expect(ranked.map((r) => r.number)).not.toContain(1);
    expect(ranked[0].score).toBeGreaterThanOrEqual(ranked[1].score);
    expect(ranked[1].score).toBeGreaterThanOrEqual(ranked[2].score);
  });

  it("gives a small bonus to the same mode", () => {
    const query = { text: "the duel freezes when the chain resolves", format: "ffa3" as const };
    const [same, other] = rankCandidates(query, [
      issue(10, "Duel freezes after chain resolves badly", { format: "tag" }),
      issue(11, "Duel freezes after chain resolves badly", { format: "ffa3" }),
    ]);
    expect(same.number).toBe(11);
    expect(same.score).toBeGreaterThan(other.score);
  });

  it("puts a same-duel report first even with a low score, and does not drop it", () => {
    const ranked = rankCandidates({ text: "the duel freezes when the chain resolves" }, [
      issue(20, "Duel freezes when the chain resolves"),
      issue(21, "Something quite different about the lobby", { sameDuel: true }),
    ]);
    expect(ranked.map((r) => r.number)).toEqual([21, 20]);
    expect(ranked[0].sameDuel).toBe(true);
  });

  it("returns nothing when no candidate is close, and counts an issue once", () => {
    expect(rankCandidates({ text: "the duel freezes when the chain resolves" }, [issue(30, "Lobby avatar is missing")])).toEqual([]);
    const twice = rankCandidates({ text: "duel freezes when chain resolves" }, [issue(40, "Duel freezes when chain resolves"), issue(40, "Duel freezes when chain resolves")]);
    expect(twice).toHaveLength(1);
  });
});
