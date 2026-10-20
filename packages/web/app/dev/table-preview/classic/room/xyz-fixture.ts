import type { DuelCard, DuelCardInfo, DuelPrompt, DuelRoom } from "@yugidraft/shared/duels";
import { LOCATION_MZONE, LOCATION_OVERLAY } from "@/components/duel/constants";
import { link } from "@/components/duel/fx-lab/board";

/** The Xyz of the preview: a Rank 4 with three materials, so the Materials window and the detach pick have something to show. */
const TORNADO: DuelCardInfo = {
  code: 6983839, name: "Tornado Dragon", type: 0x800001 | 0x20, attack: 2100, defense: 2000, level: 4, attribute: 0x8, race: "Wyrm",
  description: "2 Level 4 monsters\nOnce per turn (Quick Effect): You can detach 1 material from this card, then target 1 Spell/Trap on the field; destroy it.",
};
const MATERIALS: DuelCardInfo[] = [
  { code: 15025844, name: "Mystical Elf", type: 0x11, attack: 800, defense: 2000, level: 4, attribute: 0x10, race: "Spellcaster", description: "A delicate elf that lacks offense, but has a terrific defense." },
  { code: 91152256, name: "Celtic Guardian", type: 0x11, attack: 1400, defense: 1200, level: 4, attribute: 0x8, race: "Warrior", description: "An elf who learned to wield a sword, he baffles enemies with lightning-swift attacks." },
  { code: 48305365, name: "Axe Raider", type: 0x11, attack: 1700, defense: 1150, level: 4, attribute: 0x1, race: "Warrior", description: "An axe-wielding monster of tremendous strength and agility." },
];

export const XYZ_STATE_IDS = ["xyz", "xyz-view"] as const;
export type XyzStateId = (typeof XYZ_STATE_IDS)[number];
export const isXyzStateId = (value: string | null): value is XyzStateId => value != null && (XYZ_STATE_IDS as readonly string[]).includes(value);

/**
 * The "chain" fixture with your Dark Magician zone turned into the Xyz: a chain link of that Xyz ("activates its effect"), and for `xyz` the engine's
 * detach prompt (pick a material) over it. `xyz-view` has no prompt: click the Xyz and press "View materials" to see the Materials window.
 */
export function xyzRoom(base: DuelRoom, id: XyzStateId): DuelRoom {
  const room = structuredClone(base);
  const engine = room.engine!;
  const seat = engine.seats[0];
  const sequence = 2;
  const materials: DuelCard[] = MATERIALS.map((info, index) => ({
    controller: 0, location: LOCATION_OVERLAY, sequence: index, position: 0, ...info,
  }));
  seat.monsters[sequence] = { controller: 0, location: LOCATION_MZONE, sequence, position: 1, ...TORNADO, materials } as DuelCard;
  const host = { controller: 0, location: LOCATION_MZONE, sequence, name: TORNADO.name! };
  // The zone of the link puts its numbered badge and callout on the Xyz, as a live duel does.
  engine.chain = [{ ...link(1, 0, TORNADO), zone: { controller: 0, location: LOCATION_MZONE, sequence } }];
  engine.prompt = id === "xyz" ? ({
    id: "preview-detach", seat: 0, kind: "cards", title: "Select the Xyz Material(s) to detach", min: 1, max: 1, cancelable: false,
    options: MATERIALS.map((info, index) => ({
      id: `card:${index}`, label: info.name!, location: LOCATION_OVERLAY, sequence: index, controller: 0, host, card: info,
    })),
  } as unknown as DuelPrompt) : null;
  return room;
}
