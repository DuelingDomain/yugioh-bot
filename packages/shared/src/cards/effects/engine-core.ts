import { z } from "zod";
import type { BridgeDeck } from "./bridge-engines.js";
import { isExtraDeckCard, type Card } from "./card.js";
import { bridgeLegal } from "./bridge-engine.js";
import { actionEvidence, matchesBridgeFilter, canReceiveSummon } from "./bridge-text.js";
import { bridgeMaterials } from "./bridge-materials.js";
import { groundBridgeGraph } from "./bridge-grounding.js";
import { REVIEWED_CORE_PLANS } from "./engine-core-plans.js";
import type { BridgeFormat, BridgeGraphData, CardCapability, Capability } from "./bridge-types.js";

export const CoreCardSchema = z.object({
  code: z.number().int().positive().max(0xffffffff), name: z.string().min(1).max(200),
  section: z.enum(["main", "extra"]), role: z.enum(["starter", "searcher", "extender", "payoff", "support", "material"]),
  copies: z.number().int().min(1).max(3), held: z.number().int().min(0).max(91), needed: z.number().int().min(0).max(3),
  points: z.number().int().nonnegative().optional(),
}).strict().refine(card => card.needed === Math.max(0, card.copies - card.held), { message: "Core copy accounting must agree" });
export const EngineCoreSchema = z.object({ cards: z.array(CoreCardSchema).max(100), ready: z.boolean(), gaps: z.array(z.string().min(1).max(500)).max(100), caption: z.string().max(500) }).strict()
  .refine(core => new Set(core.cards.map(card => card.code)).size === core.cards.length && core.ready === (core.cards.length > 0 && core.gaps.length === 0), { message: "Core readiness must agree with its dependency gaps" });
export type CoreCard = z.infer<typeof CoreCardSchema>;
export type EngineCore = z.infer<typeof EngineCoreSchema>;
export interface PlannedCoreCard {
  card: Card; copies: number; role: CoreCard["role"]; evidence: string[];
}
export interface EngineCorePlan { cards: PlannedCoreCard[]; gaps: string[]; caption: string }
export interface CoreContext { format: BridgeFormat; deck?: BridgeDeck; deckCards?: readonly number[]; genesysRemaining?: number }
const access = new Set(["search", "special_summon", "normal_summon", "set_spell_trap", "place_on_field", "send_to_gy"]);
const copyLimit = (card: Card, format: BridgeFormat) => format === "genesys" ? 3 : card.banTcg === "Forbidden" ? 0 : card.banTcg === "Limited" ? 1 : card.banTcg === "Semi-Limited" ? 2 : 3;

function targets(cap: Capability, card: Card): boolean {
  return cap.targets ? cap.targets.includes(card.id) : !!cap.filter && matchesBridgeFilter(cap.filter, card);
}
function checkedActions(row: CardCapability, members: readonly CardCapability[]): Capability[] {
  return row.provides.filter(cap => access.has(cap.key) && cap.filter && !cap.filter.this_card
    && actionEvidence(row.card, cap.key, cap.filter) && members.some(target => target.id !== row.id && targets(cap, target.card)));
}

/** Graph/catalog/format-only plan. Never cache held/needed copies or subscriber budgets here. */
export function deriveEngineCore(input: BridgeGraphData, engine: string, format: BridgeFormat): EngineCorePlan {
  const graph = groundBridgeGraph(input), members = new Set(graph.groups[engine] ?? []);
  const rows = new Map(graph.capabilities.map(row => [row.id, row]));
  const memberRows = [...members].flatMap(id => rows.has(id) ? [rows.get(id)!] : []);
  const byName = new Map(graph.capabilities.map(row => [row.card.name, row]));
  const selected = new Map<number, PlannedCoreCard>(), gaps: string[] = [];
  const add = (row: CardCapability, copies: number, role: CoreCard["role"], evidence: string[]) => {
    if (!bridgeLegal(row.card, format)) { gaps.push(`${row.card.name} is unavailable in ${format}.`); return; }
    const prior = selected.get(row.id);
    selected.set(row.id, { card: row.card, copies: Math.max(prior?.copies ?? 0, Math.min(copies, copyLimit(row.card, format))),
      role: prior?.role ?? role, evidence: [...new Set([...(prior?.evidence ?? []), ...evidence])] });
  };
  const reviewed = REVIEWED_CORE_PLANS[engine];
  if (reviewed) {
    for (const [name, copies, role] of reviewed.cards) {
      // This reviewed Synchro route has a separate Link-free Genesys entry.
      if (format === "genesys" && engine === "Blue-Eyes" && name === "Spirit with Eyes of Blue") continue;
      const row = byName.get(name);
      if (!row) { gaps.push(`Missing catalog dependency: ${name}.`); continue; }
      const actions = checkedActions(row, memberRows);
      if (!members.has(row.id) && !actions.length) { gaps.push(`No checked ${engine} support action for ${name}.`); continue; }
      const printedRole = role === "material" ? row.card.kind === "monster" || /Tuner[^.]*Level 1/i.test(row.card.text)
        : role === "starter" || role === "searcher" ? actions.length > 0
        : row.provides.some(cap => !["monster", "spell", "trap", "type", "attribute", "level", "name", "archetype", "subtype", "condition", "trigger"].includes(cap.key))
          && /Special Summon|add |Set |place |negate|destroy|banish|return |shuffle|gain/i.test(row.card.text);
      if (!printedRole) { gaps.push(`Unsupported ${role} role for ${name}.`); continue; }
      add(row, copies, role, actions.length ? actions.map(cap => cap.evidence) : [row.card.text]);
    }
    for (const [name, printed] of reviewed.procedures) {
      const row = byName.get(name);
      if (!row || !printed.test(row.card.text)) gaps.push(`Unsupported printed dependency: ${name}.`);
    }
    // Material/procedure closure for the reviewed routes, including transformed Trap Tuners.
    const cards = [...selected.values()].map(slot => slot.card);
    if (engine === "Tearlaments" && cards.filter(card => card.monsterType === "Aqua" && !isExtraDeckCard(card)).length < 2)
      gaps.push("Kaleido-Heart requires two available Aqua materials.");
    if (engine === "Ashtra") {
      const tuners = cards.filter(card => card.kind === "trap" && /Tuner[^.]*Level 1/i.test(card.text));
      for (const extra of cards.filter(isExtraDeckCard)) if (!tuners.length || !cards.some(card => card.kind === "monster" && !isExtraDeckCard(card) && (card.level ?? 0) + 1 === extra.level))
        gaps.push(`${extra.name} requires an Ashtra Trap Tuner and a matching non-Tuner body.`);
    }
    if (engine === "Blue-Eyes") {
      const tuner = cards.some(card => card.level === 1 && card.subtypes.includes("tuner"));
      const white = cards.some(card => card.name === "Blue-Eyes White Dragon" && card.level === 8 && card.monsterType === "Dragon");
      const ultimate = cards.find(card => card.name === "Blue-Eyes Ultimate Spirit Dragon");
      if (!tuner || !white) gaps.push("Spirit Dragon requires a Level 1 Tuner and the Level 8 Blue-Eyes body.");
      if (!ultimate || ultimate.attribute !== "LIGHT" || ultimate.monsterType !== "Dragon" || !ultimate.subtypes.includes("synchro"))
        gaps.push("Spirit Dragon requires a LIGHT Dragon Synchro recipient.");
    }
    if (engine === "Azamina") for (const extra of cards.filter(isExtraDeckCard)) {
      if (!canReceiveSummon(extra, byName.get("The Hallowed Azamina")?.card.text ?? "")) gaps.push(`Unsupported alternative Fusion recipient: ${extra.name}.`);
    }
    if (engine === "Regenesis" && !cards.some(card => card.atk === 2500 && card.def === 2500 && card.name !== "Regenesis Lord"))
      gaps.push("Regenesis Lord requires a face-up body with 2500 original ATK and DEF.");
  } else {
    // Directional Deck access dominates recovery/centrality. Unsupported filters
    // never become edges; conditional/delayed access never becomes a starter.
    const legal = memberRows.filter(row => bridgeLegal(row.card, format));
    const scored = legal.map(row => {
      const actions = checkedActions(row, legal);
      const deck = actions.filter(cap => cap.from?.includes("deck"));
      const independent = !isExtraDeckCard(row.card) && row.card.kind !== "trap" && !/Cannot be Normal Summoned|Must (?:first )?be Special Summoned/i.test(row.card.text);
      const starters = independent ? deck.filter(cap => !/End Phase|next turn|is sent to the GY|is destroyed|During your opponent/i.test(cap.evidence)) : [];
      const incoming = legal.filter(other => checkedActions(other, [row]).length).length;
      return { row, actions, starters, score: starters.length * 12 + deck.length * 3 + actions.length + incoming * 0.5 };
    }).sort((a, b) => b.score - a.score || a.row.id - b.row.id);
    const starter = scored.find(slot => slot.starters.length);
    if (starter) add(starter.row, 3, "starter", starter.starters.map(cap => cap.evidence));
    else gaps.push(`No supported Main Deck starter/searcher for ${engine}.`);
    const ext = scored.find(slot => slot.row.id !== starter?.row.id && !isExtraDeckCard(slot.row.card) && slot.actions.length
      && slot.row.provides.some(cap => ["special_summon", "search", "set_spell_trap", "place_on_field"].includes(cap.key)));
    if (ext) add(ext.row, 2, "extender", ext.actions.map(cap => cap.evidence));
    else gaps.push(`No supported extender/resource loop for ${engine}.`);
    const payoffs = scored.filter(slot => slot.row.provides.some(cap => ["negate", "destroy", "banish", "return_to_deck"].includes(cap.key)));
    const payoff = payoffs.find(slot => !isExtraDeckCard(slot.row.card)) ?? payoffs[0];
    if (payoff) add(payoff.row, 1, "payoff", [payoff.row.card.text]);
    else gaps.push(`No supported payoff for ${engine}.`);
    // Close specific named Deck targets of selected access effects. Do not treat
    // every printed theme mention as an instruction to add that card.
    for (const slot of [...selected.values()]) {
      const row = rows.get(slot.card.id)!;
      for (const cap of checkedActions(row, legal)) {
        if (!cap.from?.includes("deck")) continue;
        const choices = legal.filter(target => targets(cap, target.card) && !isExtraDeckCard(target.card));
        if (!choices.length) { gaps.push(`Missing Deck target for ${slot.card.name}.`); continue; }
        if (!choices.some(target => selected.has(target.id))) {
          const target = choices.sort((a, b) => a.id - b.id)[0]!;
          add(target, 1, "support", [cap.evidence]);
        }
      }
    }
    // A single procedure family keeps a fallback from mixing unrelated Fusion,
    // Ritual and Synchro routes. Unsupported Extra procedures block readiness.
    if (payoff && isExtraDeckCard(payoff.row.card)) {
      const materials = bridgeMaterials(payoff.row.card, legal.map(row => row.card), format);
      if (!materials) gaps.push(`Unsupported material procedure for ${payoff.row.card.name}.`);
      else for (const id of new Set(materials)) add(rows.get(id)!, materials.filter(code => code === id).length, "material", [payoff.row.card.text.split(/[\r\n]/)[0]!]);
    }
    // Generic selection cannot prove arbitrary conditions/locks or mandatory
    // named setup. Keep the provisional core visible with an explicit gap.
    for (const slot of [...selected.values()]) {
      const row = rows.get(slot.card.id)!;
      for (const need of row.needs) if (need.filter?.names?.length && /must|cannot|require/i.test(need.evidence)) {
        for (const name of need.filter.names) {
          const target = byName.get(name);
          if (!target || !members.has(target.id)) gaps.push(`Unresolved named dependency for ${slot.card.name}: ${name}.`);
          else add(target, 1, "material", [need.evidence]);
        }
      }
      if (row.locks.some(lock => lock.unresolved)) gaps.push(`Unresolved lock for ${slot.card.name}.`);
    }
    // The extracted graph does not prove complete setup/material procedures for
    // an arbitrary group. Keep its role proposal visible, but fail readiness
    // closed until those procedures have a narrow checked rule.
    gaps.push(`Unresolved full dependency procedure for ${engine}; the role proposal is provisional.`);
    // Every selected piece must connect to the entry through a checked action or
    // a supported material procedure. Membership alone does not prove a plan.
    const connected = new Set(starter ? [starter.row.id] : []);
    let changed = true;
    while (changed) {
      changed = false;
      for (const slot of selected.values()) {
        const row = rows.get(slot.card.id)!;
        const joined = [...connected].some(id => {
          const from = rows.get(id)!;
          return checkedActions(from, [row]).length > 0 || checkedActions(row, [from]).length > 0;
        });
        const material = isExtraDeckCard(row.card) ? bridgeMaterials(row.card, [...selected.values()].map(value => value.card), format) : null;
        if (!connected.has(row.id) && (joined || material?.every(id => connected.has(id)))) { connected.add(row.id); changed = true; }
      }
    }
    for (const slot of selected.values()) {
      const row = rows.get(slot.card.id)!;
      if (!connected.has(row.id)) gaps.push(`No coherent checked access to ${row.card.name} from the selected starter.`);
      if (row.card.kind === "monster" && !isExtraDeckCard(row.card) && /Must (?:first )?be (?:Special|Ritual) Summoned/i.test(row.card.text))
        gaps.push(`Unresolved Summoning procedure for ${row.card.name}.`);
      if (row.needs.some(need => need.key === "material" && !need.filter?.names.length))
        gaps.push(`Unresolved material requirement for ${row.card.name}.`);
    }
  }
  const cards = [...selected.values()];
  if (!cards.some(slot => ["starter", "searcher"].includes(slot.role))) gaps.push("Missing starter/searcher role.");
  if (!cards.some(slot => ["extender", "support", "material"].includes(slot.role))) gaps.push("Missing extender/resource role.");
  if (!cards.some(slot => slot.role === "payoff")) gaps.push("Missing payoff role.");
  if (cards.reduce((n, slot) => n + slot.copies, 0) > 12) gaps.push("Dependency-complete engine exceeds the 12-copy target; review deck space.");
  return { cards, gaps: [...new Set(gaps)], caption: reviewed?.caption ?? `${engine}: proposed access, resource and payoff roles from checked directional actions.` };
}

/** Subscriber projection. Side and Deck Master spend points, but never satisfy ownership. */
export function projectEngineCore(plan: EngineCorePlan, context: CoreContext): EngineCore {
  const { deck, format } = context, owned = deck ? [...deck.main, ...deck.extra] : context.deckCards ?? [];
  const singleton = deck?.mode === "domain" || deck?.singleton === true;
  const cards: CoreCard[] = plan.cards.map(slot => {
    const held = owned.filter(id => id === slot.card.id).length;
    const copies = Math.min(slot.copies, singleton ? 1 : copyLimit(slot.card, format));
    return { code: slot.card.id, name: slot.card.name, section: isExtraDeckCard(slot.card) ? "extra" : "main", role: slot.role,
      copies, held, needed: Math.max(0, copies - held), ...(format === "genesys" ? { points: slot.card.genesysPoints } : {}) };
  });
  const gaps = [...plan.gaps];
  for (const card of cards) {
    const limit = singleton ? 1 : copyLimit(plan.cards.find(slot => slot.card.id === card.code)!.card, format);
    if (deck?.mode === "domain" && deck.deckMaster === card.code) gaps.push(`${card.name} is the Deck Master and cannot also appear in the Domain deck.`);
    const afterAdd = Math.max(card.held, card.copies) + (deck?.side?.filter(id => id === card.code).length ?? 0);
    if (afterAdd > limit) gaps.push(`${card.name}: adding the core leaves ${afterAdd} copies across Main, Extra and Side; limit ${limit}.`);
  }
  if (format === "genesys") {
    const points = cards.reduce((n, card) => n + (card.needed ? card.needed * (card.points ?? Infinity) : 0), 0);
    const remaining = context.genesysRemaining ?? 100;
    if (!Number.isFinite(points)) gaps.push("Genesys points are unavailable for a required copy.");
    else if (points > remaining) gaps.push(`Engine needs ${points} Genesys points; ${remaining} remaining.`);
  }
  if (deck) for (const section of ["main", "extra"] as const) {
    const needed = cards.filter(card => card.section === section).reduce((n, card) => n + card.needed, 0);
    const free = Math.max(0, (section === "main" ? 60 : 15) - deck[section].length);
    if (needed > free) gaps.push(`${section === "main" ? "Main" : "Extra"} Deck needs ${needed} slots; ${free} free.`);
  }
  return EngineCoreSchema.parse({ cards, ready: cards.length > 0 && gaps.length === 0, gaps: [...new Set(gaps)], caption: plan.caption });
}
