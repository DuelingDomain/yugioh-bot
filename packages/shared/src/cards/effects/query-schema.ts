import * as z from "zod";
import { CardFilter, CardTags, GameEvent } from "./tags.js";
import { describe, isEmptyObject, type EffectQuery, type Interpretation } from "./query.js";

// Reuse the stored-tag vocabulary, including its Type/Attribute/verb/zone enums.
const object = CardFilter.pick({ kinds: true, subtypes: true, types: true, attributes: true, archetypes: true }).extend({
  atkMin: z.int().min(0).max(100000).optional(), atkMax: z.int().min(0).max(100000).optional(),
  levelMin: z.int().min(0).max(13).optional(), levelMax: z.int().min(0).max(13).optional(),
}).strict();
const cardObject = object.extend({ archetypes: z.array(z.string()).max(0) });
const eventObject = object.omit({ atkMin: true, atkMax: true });
const supportObject = object.omit({ atkMin: true, atkMax: true, levelMin: true, levelMax: true }).extend({
  kinds: object.shape.kinds.max(0), subtypes: object.shape.subtypes.max(0),
});
const event = z.object({
  verbs: z.array(GameEvent.shape.verb).min(1).max(12), from: GameEvent.shape.from,
  player: z.enum(["you", "opponent"]).optional(), self: z.boolean(), object: eventObject,
}).strict();
/** Model replies cannot add text, dates, names, intents, or out-of-vocabulary facets. */
export const EffectQuerySchema = z.object({
  card: cardObject, roles: CardTags.shape.roles, does: event.optional(), reactsTo: event.optional(),
  supports: supportObject.optional(), quick: z.boolean(), worksFrom: GameEvent.shape.from.element.optional(), text: z.literal(""),
}).strict();

export function validateEffectReading(value: unknown, archetypes: ReadonlySet<string>): Interpretation | null {
  const parsed = EffectQuerySchema.safeParse(value);
  if (!parsed.success) return null;
  const query: EffectQuery = parsed.data;
  // Only accept facets this matcher actually enforces in their context.
  // Root archetypes are represented by supports in the deterministic reader.
  if (query.card.archetypes.length) return null;
  if ([query.does?.object, query.reactsTo?.object].some(target => target && (target.atkMin !== undefined || target.atkMax !== undefined))) return null;
  if (query.supports && (isEmptyObject(query.supports) || query.supports.kinds.length || query.supports.subtypes.length ||
    query.supports.atkMin !== undefined || query.supports.atkMax !== undefined || query.supports.levelMin !== undefined || query.supports.levelMax !== undefined)) return null;
  for (const target of [query.card, query.supports, query.does?.object, query.reactsTo?.object]) {
    if (!target) continue;
    if (target.archetypes.some(name => !archetypes.has(name))) return null;
    if (target.atkMin !== undefined && target.atkMax !== undefined && target.atkMin > target.atkMax) return null;
    if (target.levelMin !== undefined && target.levelMax !== undefined && target.levelMin > target.levelMax) return null;
  }
  const chips = describe(query);
  return chips.length ? { query, chips } : null;
}
