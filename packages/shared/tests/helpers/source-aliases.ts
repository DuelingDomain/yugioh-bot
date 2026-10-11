import { fileURLToPath } from "node:url";

/** Resolve the worktree shared source without rebuilding the live dist. */
export const sharedSourceAliases = {
  "@yugidraft/shared/access/owner-access": fileURLToPath(new URL("../../src/access/owner-access.ts", import.meta.url)),
  "@yugidraft/shared/duels": fileURLToPath(new URL("../../src/duels/index.ts", import.meta.url)),
  "@yugidraft/shared/db": fileURLToPath(new URL("../../src/db/index.ts", import.meta.url)),
  "@yugidraft/shared/services": fileURLToPath(new URL("../../src/services/index.ts", import.meta.url)),
  "@yugidraft/shared/types": fileURLToPath(new URL("../../src/types/index.ts", import.meta.url)),
  "@yugidraft/shared/tournaments": fileURLToPath(new URL("../../src/tournaments/index.ts", import.meta.url)),
  "@yugidraft/shared/util/web-slug": fileURLToPath(new URL("../../src/util/web-slug.ts", import.meta.url)),
  "@yugidraft/shared/ws": fileURLToPath(new URL("../../src/ws/index.ts", import.meta.url)),
  "@yugidraft/shared/ws/talk": fileURLToPath(new URL("../../src/ws/talk.ts", import.meta.url)),
  "@yugidraft/shared/scoring": fileURLToPath(new URL("../../src/scoring/index.ts", import.meta.url)),
  "@yugidraft/shared/notify": fileURLToPath(new URL("../../src/notify/index.ts", import.meta.url)),
};
