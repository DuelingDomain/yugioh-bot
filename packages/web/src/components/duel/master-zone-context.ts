import { createContext, type ComponentType } from "react";

/** What a seat field draws in its Deck Master Zone: the seat and the side of the table it sits on. */
export interface MasterZoneProps {
  seat: number;
  side: "you" | "opp";
}

/**
 * The Deck Master Zone of the multi-seat tables (3-way, 4-way, Tag). A table sets the component (`SeatMasterZone`,
 * master-badge.tsx) when it plays Domain; the seat field then keeps a column for it left of its Field Spell Zone. It is a context
 * of its own, so field.tsx does not import the badge (the badge already imports field.tsx). Null: no zone (Standard, and every 1v1 room).
 */
export const MasterZoneContext = createContext<ComponentType<MasterZoneProps> | null>(null);
