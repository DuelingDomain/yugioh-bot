// Opt in: this test needs a mounted real engine bundle. The normal suite stays portable.
import { it } from "vitest";
if (process.env.DECK_IMPORT_VERIFY === "1") await import("../../../scripts/verify-deck-import");
else it.skip("real engine deck imports (set DECK_IMPORT_VERIFY=1 and DUEL_DATA_DIR)", () => {});
