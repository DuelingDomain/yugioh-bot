import type { DuelSkin, DuelSkinSlot } from "../skin";
import docks from "./docks.module.css";
import feedback from "./feedback.module.css";
import fx from "./fx.module.css";
import menus from "./menus.module.css";
import panels from "./panels.module.css";
import phaseBar from "./phase-bar.module.css";
import prompts from "./prompts.module.css";
import rails from "./rails.module.css";
import table from "./table.module.css";

type CssModule = Readonly<Record<string, string>>;

/**
 * Which CSS modules feed which skin slot, in merge order. A slot with several modules lets several workers fill one
 * slot from separate files (`field`: the table, the rails and the docks). A class name that appears in two modules of
 * the same slot is a bug: the merge would give one V1 element the classes of both. `tests/duel-skins.test.ts` fails on it.
 */
export const SOLID_SLOT_MODULES: Record<DuelSkinSlot, { names: string[]; modules: CssModule[] }> = {
  field: { names: ["table", "rails", "docks"], modules: [table, rails, docks] },
  lp: { names: ["rails"], modules: [rails] },
  station: { names: ["phase-bar"], modules: [phaseBar] },
  feedback: { names: ["feedback"], modules: [feedback] },
  side: { names: ["panels"], modules: [panels] },
  inspector: { names: ["panels"], modules: [panels] },
  history: { names: ["panels"], modules: [panels] },
  menu: { names: ["menus"], modules: [menus] },
  pile: { names: ["menus"], modules: [menus] },
  prompt: { names: ["prompts"], modules: [prompts] },
  tray: { names: ["prompts"], modules: [prompts] },
  precheck: { names: ["prompts"], modules: [prompts] },
  chain: { names: ["fx"], modules: [fx] },
  battle: { names: ["fx"], modules: [fx] },
};

/** Merges CSS modules into one class map; a key in several modules gets the classes joined (a bug the test catches). */
export function mergeModules(modules: readonly CssModule[]): Record<string, string> {
  if (modules.length === 1) return modules[0] as Record<string, string>;
  const out: Record<string, string> = {};
  for (const module of modules) {
    for (const key of Object.keys(module)) out[key] = out[key] ? `${out[key]} ${module[key]}` : module[key];
  }
  return out;
}

/** The skin 3D mode puts around the V1 components: classes added after their own, per slot (see `useSkinStyles`). */
export const SOLID_SKIN: DuelSkin = Object.fromEntries(
  (Object.keys(SOLID_SLOT_MODULES) as DuelSkinSlot[]).map((slot) => [slot, mergeModules(SOLID_SLOT_MODULES[slot].modules)]),
) as DuelSkin;
