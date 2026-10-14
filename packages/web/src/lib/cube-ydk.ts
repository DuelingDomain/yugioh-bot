import { ExpectedError } from "@yugidraft/shared/observability";
import type { CubePools } from "@yugidraft/shared/types";
import type { CubeService } from "@yugidraft/shared/services";
import { parseDeckText } from "@/components/duel/ydk";
import { IMPORT_MAX_DISTINCT, mergeCopies, tooManyDistinct } from "./ydk-file";

export interface YdkImportResult {
  /** Different cards the file put in the cube. */
  added: number;
  /** Copies the cube gained (after the 99 cap). */
  copies: number;
  /** Passcodes the catalog does not know. */
  unknown: number[];
  lookupLimited?: true;
  moves?: import("@yugidraft/shared/duels").DeckSectionMove[];
  messages?: string[];
}

const copiesById = (pools: CubePools): Map<number, number> =>
  new Map([...pools.main, ...pools.extra].map((c) => [c.catalogCardId, c.maxCopies]));

const totalCopies = (pools: CubePools): number =>
  [...pools.main, ...pools.extra].reduce((sum, c) => sum + c.maxCopies, 0);

/** A list with no section header is a plain passcode list: read it as `#main`. A ydke:// link is left alone. */
function startInMain(text: string): string {
  const clean = text.replace(/^\uFEFF/, "");
  return clean.trim().toLowerCase().startsWith("ydke://") ? clean : `#main\n${clean}`;
}

/**
 * Merge a YDK file into a cube through the passcode import. Main and side lines go to the main
 * pool; all Main and Extra entries are then routed by real card type. Copies
 * add to the ones the cube already holds, up to 99. Both groups are looked up before anything
 * is written, and written together, so a failed lookup leaves the cube as it was.
 */
export async function importYdkIntoCube(cubes: CubeService, cubeId: number, text: string): Promise<YdkImportResult> {
  const ydk = parseDeckText(startInMain(text));
  const distinct = new Set([...ydk.main, ...ydk.side, ...ydk.extra, ...(ydk.deckMaster != null ? [ydk.deckMaster] : [])]);
  if (distinct.size > IMPORT_MAX_DISTINCT) throw new ExpectedError(tooManyDistinct(distinct.size), 400);
  const before = totalCopies(cubes.getCubePools(cubeId));
  const existing = copiesById(cubes.getCubePools(cubeId));
  const all: Array<{ codes: number[]; pool: "main" | "extra" }> = [
    { codes: [...ydk.main, ...ydk.side, ...(ydk.deckMaster != null ? [ydk.deckMaster] : [])], pool: "main" },
    { codes: ydk.extra, pool: "extra" },
  ];
  const groups = all.filter((g) => g.codes.length > 0);
  const merged = groups.map(({ codes, pool }) => {
    const withExisting = mergeCopies(codes, existing);
    // A card in both sections adds up: the next group starts from this group's totals.
    const totals = new Map<number, number>();
    for (const code of withExisting) totals.set(code, (totals.get(code) ?? 0) + 1);
    for (const [code, total] of totals) existing.set(code, total);
    return { codes: withExisting, pool, reportCodes: codes };
  });
  const result = await cubes.importPasscodeGroups(cubeId, merged);
  return {
    added: result.added,
    copies: totalCopies(cubes.getCubePools(cubeId)) - before,
    unknown: result.unknown,
    ...(result.moves ? { moves: result.moves, messages: result.messages } : {}),
    ...(result.lookupLimited ? { lookupLimited: result.lookupLimited } : {}),
  };
}
