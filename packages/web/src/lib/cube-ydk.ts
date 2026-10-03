import type { CubePools } from "@yugidraft/shared/types";
import type { CubeService } from "@yugidraft/shared/services";
import { parseDeckText } from "@/components/duel/ydk";
import { mergeCopies } from "./ydk-file";

export interface YdkImportResult {
  /** Different cards the file put in the cube. */
  added: number;
  /** Copies the cube gained (after the 99 cap). */
  copies: number;
  /** Passcodes the catalog does not know. */
  unknown: number[];
}

const copiesById = (pools: CubePools): Map<number, number> =>
  new Map([...pools.main, ...pools.extra].map((c) => [c.catalogCardId, c.maxCopies]));

const totalCopies = (pools: CubePools): number =>
  [...pools.main, ...pools.extra].reduce((sum, c) => sum + c.maxCopies, 0);

/**
 * Merge a YDK file into a cube through the passcode import. Main and side lines go to the main
 * pool unless the card is an Extra Deck monster; `#extra` lines go to the extra pool. Copies
 * add to the ones the cube already holds, up to 99. Both groups are looked up before anything
 * is written, and written together, so a failed lookup leaves the cube as it was.
 */
export async function importYdkIntoCube(cubes: CubeService, cubeId: number, text: string): Promise<YdkImportResult> {
  const ydk = parseDeckText(text.replace(/^\uFEFF/, ""));
  const before = totalCopies(cubes.getCubePools(cubeId));
  const existing = copiesById(cubes.getCubePools(cubeId));
  const groups: Array<{ codes: number[]; pool?: "extra" }> = [
    { codes: [...ydk.main, ...ydk.side, ...(ydk.deckMaster != null ? [ydk.deckMaster] : [])] },
    { codes: ydk.extra, pool: "extra" },
  ].filter((g) => g.codes.length > 0);
  const merged = groups.map(({ codes, pool }) => {
    const withExisting = mergeCopies(codes, existing);
    // A card in both sections adds up: the next group starts from this group's totals.
    const totals = new Map<number, number>();
    for (const code of withExisting) totals.set(code, (totals.get(code) ?? 0) + 1);
    for (const [code, total] of totals) existing.set(code, total);
    return { codes: withExisting, pool };
  });
  const result = await cubes.importPasscodeGroups(cubeId, merged);
  return {
    added: result.added,
    copies: totalCopies(cubes.getCubePools(cubeId)) - before,
    unknown: result.unknown,
  };
}
