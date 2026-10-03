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
 * add to the ones the cube already holds, up to 99.
 */
export async function importYdkIntoCube(cubes: CubeService, cubeId: number, text: string): Promise<YdkImportResult> {
  const ydk = parseDeckText(text.replace(/^\uFEFF/, ""));
  const before = totalCopies(cubes.getCubePools(cubeId));
  const unknown = new Set<number>();
  const touched = new Set<number>();
  const groups: Array<{ codes: number[]; pool?: "extra" }> = [
    { codes: [...ydk.main, ...ydk.side, ...(ydk.deckMaster != null ? [ydk.deckMaster] : [])] },
    { codes: ydk.extra, pool: "extra" },
  ];
  for (const { codes, pool } of groups) {
    if (codes.length === 0) continue;
    // Read the cube again for each group, so a card in both sections adds up.
    const merged = mergeCopies(codes, copiesById(cubes.getCubePools(cubeId)));
    const result = await cubes.importPasscodes(cubeId, merged, { pool });
    for (const code of result.unknown) unknown.add(code);
    for (const code of merged) if (!result.unknown.includes(code)) touched.add(code);
  }
  return {
    added: touched.size,
    copies: totalCopies(cubes.getCubePools(cubeId)) - before,
    unknown: [...unknown],
  };
}
