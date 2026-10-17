import { OcgLocation, OcgPosition } from "ocgcore-wasm";

/**
 * Names for chain-link targets. The core's BECOME_TARGET message carries only coordinates, and by the time the
 * engine reads a batch the card may have moved. A startup script (TARGET_CARD_NOTE_LUA) therefore prints the card
 * at the moment it becomes a target; the engine matches those notes to the messages by coordinates. Pure: views.ts
 * and the legacy views both use it.
 *
 * Privacy: public text names only a card the whole table can see. Frozen visibility snapshots may give eligible
 * seats a private name; everyone else gets "a face-down card" or "a card".
 */
export const TARGET_CARD_NOTE_PREFIX = "YGD:TARGET_CARD:";

/** Appended to the chain-target startup script. Registers one global continuous effect and changes no game state. */
export const TARGET_CARD_NOTE_LUA = `
local function noteTargetCard(tc)
  local controller=Duel.MPSeatOf and Duel.MPSeatOf(tc) or tc:GetControler()
  Debug.Message("${TARGET_CARD_NOTE_PREFIX}"..controller..":"..tc:GetLocation()..":"..tc:GetSequence()..":"..tc:GetCode()..":"..tc:GetPosition())
end
local becomeTarget=Effect.GlobalEffect()
becomeTarget:SetType(EFFECT_TYPE_FIELD|EFFECT_TYPE_CONTINUOUS)
becomeTarget:SetCode(EVENT_BECOME_TARGET)
becomeTarget:SetOperation(function(e,tp,eg)
  for tc in aux.Next(eg) do pcall(noteTargetCard,tc) end
end)
Duel.RegisterEffect(becomeTarget,0)
`;

export interface TargetCardNote {
  controller: number;
  location: number;
  sequence: number;
  code: number;
  position: number;
}

/** Viewer (null for spectators) to the independently visible code at the target's original slot. */
export type TargetVisibility = ReadonlyMap<number | null, number>;

/** Original coordinates, frozen viewer visibility and write-once names, shared by announcement snapshots. */
export interface TargetLabel {
  zone: { controller: number; location: number; sequence: number };
  visibleCodes?: TargetVisibility;
  label?: string;
  privateLabels?: Record<number, string>;
}

export function targetLabelFor(target: TargetLabel | undefined, viewer: number | null = null): string | undefined {
  return (viewer == null ? undefined : target?.privateLabels?.[viewer]) ?? target?.label;
}

/** Parse "controller:location:sequence:code:position" (the text after the prefix), or null when malformed. */
export function parseTargetCardNote(text: string): TargetCardNote | null {
  if (!text.startsWith(TARGET_CARD_NOTE_PREFIX)) return null;
  const parts = text.slice(TARGET_CARD_NOTE_PREFIX.length).split(":").map(Number);
  if (parts.length !== 5 || parts.some((part) => !Number.isInteger(part) || part < 0)) return null;
  const [controller, location, sequence, code, position] = parts as [number, number, number, number, number];
  return { controller, location, sequence, code, position };
}

/**
 * What the whole table may read for one target: its name when the card is face-up on the field, in the Graveyard or
 * face-up banished; "a face-down card" for a Set card; "a card" for anything in a hidden place or without a note.
 */
export function publicTargetLabel(args: { location: number; position: number; name?: string }): string {
  const faceUp = (args.position & OcgPosition.FACEUP) !== 0 && (args.position & OcgPosition.FACEDOWN) === 0;
  if (args.location === OcgLocation.MZONE || args.location === OcgLocation.SZONE) return faceUp ? (args.name ?? "a card") : "a face-down card";
  if (args.location === OcgLocation.GRAVE) return args.name ?? "a card";
  if (args.location === OcgLocation.REMOVED) return faceUp ? (args.name ?? "a card") : "a face-down card";
  return "a card";
}

/** "A", "A and B", "A, B and C". */
function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/**
 * The target list of a link as a phrase ("Black Luster Soldier - Soldier of Light and Darkness", "A and a face-down
 * card"). Targets without a stored label fall back to the count ("1 card", "2 cards") when none has one.
 */
export function chainTargetPhrase(labels: ReadonlyArray<string | undefined>, count: number): string {
  const known = labels.filter((label): label is string => label != null);
  if (known.length === 0) return `${count} card${count === 1 ? "" : "s"}`;
  return joinNames(labels.map((label) => label ?? "a card"));
}

export interface TargetDescription {
  phrase: string;
  labels: string[];
  private?: Record<number, { phrase: string; labels: string[] }>;
}

/** Format an announcement once for events and log lines. Only differing audiences need another pass. */
export function describeTargets(targets: readonly (TargetLabel | undefined)[]): TargetDescription {
  const labels = targets.map((target) => target?.label);
  const description: TargetDescription = {
    phrase: chainTargetPhrase(labels, targets.length), labels: labels.map((label) => label ?? "a card"),
  };
  let viewers: Set<number> | undefined;
  for (const target of targets) {
    if (!target?.privateLabels) continue;
    for (const [viewer, label] of Object.entries(target.privateLabels)) {
      if (label !== target.label) (viewers ??= new Set()).add(Number(viewer));
    }
  }
  if (!viewers) return description;
  for (const viewer of viewers) {
    const named = targets.map((target) => targetLabelFor(target, viewer));
    (description.private ??= {})[viewer] = {
      phrase: chainTargetPhrase(named, targets.length), labels: named.map((label) => label ?? "a card"),
    };
  }
  return description;
}
