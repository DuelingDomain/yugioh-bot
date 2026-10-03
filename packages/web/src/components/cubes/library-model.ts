import type { CubeDraftType } from "@/lib/cube-type";

/** What `GET /api/cubes` sends for each row of the library. */
export interface CubeSummary {
  id: number;
  name: string;
  archetype: string | null;
  banlist?: string | null;
  /** Absent in an old response: a cube with no type is "any". */
  draftType?: CubeDraftType;
  mainCount: number;
  extraCount: number;
  setNames?: string[];
  customCardIds?: number[];
}

/**
 * `/draft template save` stores booster sets in the cubes table with no cards. The list
 * has no flag for it, so a row with sets, no pool and no card list is the template shape.
 */
export function isDraftTemplate(cube: CubeSummary): boolean {
  return (
    cube.mainCount === 0 &&
    cube.extraCount === 0 &&
    !cube.archetype &&
    (cube.setNames?.length ?? 0) > 0 &&
    (cube.customCardIds?.length ?? 0) === 0
  );
}

/** "New cube", then "New cube 2", "New cube 3", ... skipping names already taken. */
export function nextCubeName(existing: Iterable<string>): string {
  const taken = new Set(existing);
  let name = "New cube";
  let n = 2;
  while (taken.has(name)) name = `New cube ${n++}`;
  return name;
}

export type AddTab = "card" | "archetype" | "passcodes" | "ydk";

export function parseAddTab(value: string | null | undefined): AddTab {
  return value === "archetype" || value === "passcodes" || value === "ydk" ? value : "card";
}
