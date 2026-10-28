import type { Card } from "./card.js";
import type { CardFilter } from "./tags.js";

export const BRIDGE_FORMATS = ["advanced", "genesys"] as const;
export type BridgeFormat = typeof BRIDGE_FORMATS[number];
export const CAPABILITY_KEYS = [
  "monster", "spell", "trap", "type", "attribute", "level", "name", "archetype", "subtype",
  "search", "special_summon", "normal_summon", "set_spell_trap", "place_on_field", "send_to_gy", "discard",
  "banish", "tribute", "return_to_hand", "return_to_deck", "draw", "negate", "destroy", "material",
  "gy_effect", "trigger", "condition", "summon_lock", "self_removal", "activate_trap_turn_set",
  "face_down_card", "set_trap", "trap_monster",
] as const;
export type CapabilityKey = typeof CAPABILITY_KEYS[number];
export type LockScope = "while_face_up" | "rest_of_turn_after_activation" | "whole_turn_cost" | "none";
export interface Capability {
  key: CapabilityKey;
  value?: string | number;
  filter?: CardFilter;
  from?: string[];
  effect?: number;
  evidence: string;
  targets?: number[];
}
export interface SummonLock {
  scope: LockScope;
  allow: CardFilter;
  extra_deck_only: boolean;
  self_removal: boolean;
  unresolved: boolean;
  evidence: string;
}
export interface CardCapability {
  id: number;
  card: Card;
  provides: Capability[];
  needs: Capability[];
  locks: SummonLock[];
  text_hash: string;
  evidence_hash: string;
}
export const REASON_CAPS = {
  mention: 12, reach: 12, profile: 10, rule_enabler: 10, extra_deck: 10,
  searcher: 2, small_world: 2, gy_fuel: 6, type_support: 3, face_down: 8,
} as const;
export type BridgeReasonKey = keyof typeof REASON_CAPS;
export interface BridgeReason {
  key: BridgeReasonKey;
  weight: number;
  ancillary?: boolean;
  cards: number[];
  /** Printed evidence in the same order as cards. */
  evidence: string[];
  description: string;
  /** The exact capability filters used to establish the directed edges. */
  steps?: { from: number; to: number; capability: CapabilityKey }[];
  materials?: number[];
}
export type BridgeGrade = "Strong" | "Good" | "Niche" | "Risky";
export interface ArchetypeBridge {
  source: string;
  target: string;
  format: BridgeFormat;
  score: number;
  raw_score: number;
  target_mean: number;
  two_way: boolean;
  grade: BridgeGrade;
  reasons: BridgeReason[];
  cards: number[];
  warnings: string[];
  genesys_points: number | null;
  validation: "deterministic";
  judge: "pending" | "accepted";
  engine_status: "unverified";
  evidence_hash: string;
}
export interface BridgeProgress { phase: "index" | "score" | "validate" | "done"; completed: number; total: number }
export interface BridgeGroupPolicy {
  curated?: boolean;
  excluded?: boolean;
  aliases?: string[];
  include?: { names?: string[]; mentions?: string[]; name_patterns?: string[] };
}
export interface BridgeGraphData {
  capabilities: CardCapability[];
  groups: Record<string, number[]>;
  group_policies?: Record<string, BridgeGroupPolicy>;
  target_means: Record<BridgeFormat, Record<string, number>>;
  reason_frequencies?: Record<BridgeFormat, Record<string, Partial<Record<BridgeReasonKey, number>>>>;
  ancillary_outlets?: Record<BridgeFormat, Record<number, BridgeReasonKey[]>>;
  materials?: Record<BridgeFormat, Record<string, { id: number; materials: number[]; weight: number }[]>>;
}
