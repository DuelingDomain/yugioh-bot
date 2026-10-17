import { describe, expect, it } from "vitest";
import type { DuelCard, DuelSeatView } from "@yugidraft/shared/duels";
import {
  boxEdgePoint,
  equipCountText,
  equipLinePath,
  equippedToText,
  equippedWithText,
  linksTouching,
  resolveEquipLinks,
  roleOfCard,
} from "@/components/duel/equip-links";

const MZONE = 0x04;
const SZONE = 0x08;
const HAND = 0x02;

const card = (controller: number, location: number, sequence: number, extra: Partial<DuelCard> = {}): DuelCard => ({
  controller, location, sequence, position: 1, code: 100 + sequence + location, name: `Card ${controller}-${location}-${sequence}`, ...extra,
});
const hidden = (controller: number, location: number, sequence: number): DuelCard => ({ controller, location, sequence, position: 8 });

function seat(index: number, monsters: Array<DuelCard | null>, spells: Array<DuelCard | null>): DuelSeatView {
  return {
    seat: index, lp: 8000, hand: [], deckCount: 0, extraCount: 0, extra: [],
    monsters: [...monsters, ...Array.from({ length: 7 - monsters.length }, () => null)],
    spells: [...spells, ...Array.from({ length: 8 - spells.length }, () => null)],
    graveyard: [], banished: [],
  };
}

const dragon = card(0, MZONE, 1, { name: "Blue-Eyes White Dragon" });
const neo = card(0, SZONE, 2, { name: "Neo Blue-Eyes Ultimate Dragon", equippedTo: { controller: 0, location: MZONE, sequence: 1 } });

describe("resolveEquipLinks", () => {
  it("finds nothing on a board without equips", () => {
    const links = resolveEquipLinks([seat(0, [null, dragon], []), seat(1, [], [])]);
    expect(links.links).toEqual([]);
    expect(roleOfCard(links, dragon)).toBeNull();
  });

  it("links an equip card to its monster and names both ways", () => {
    const links = resolveEquipLinks([seat(0, [null, dragon], [null, null, neo]), seat(1, [], [])]);
    expect(links.links).toHaveLength(1);
    const link = links.links[0];
    expect(link.equipKey).toBe("0:8:2");
    expect(link.hostKey).toBe("0:4:1");
    expect(link.equip).toBe(neo);
    expect(link.host).toBe(dragon);
    expect(roleOfCard(links, neo)).toEqual({ role: "equip", link });
    expect(roleOfCard(links, dragon)).toEqual({ role: "host", links: [link] });
    expect(equippedToText(link)).toBe("Equipped to Blue-Eyes White Dragon");
  });

  it("keeps several equips on one monster, in zone order", () => {
    const axe = card(0, SZONE, 0, { name: "Axe of Despair", equippedTo: { controller: 0, location: MZONE, sequence: 1 } });
    const links = resolveEquipLinks([seat(0, [null, dragon], [axe, null, neo]), seat(1, [], [])]);
    const host = roleOfCard(links, dragon);
    expect(host?.role).toBe("host");
    if (host?.role !== "host") return;
    expect(host.links.map((link) => link.equip.name)).toEqual(["Axe of Despair", "Neo Blue-Eyes Ultimate Dragon"]);
    expect(equipCountText(host.links.length)).toBe("2 equips");
    expect(equippedWithText(host.links)).toBe("Equipped with Axe of Despair, Neo Blue-Eyes Ultimate Dragon");
  });

  it("works across the table: an equip that took a monster from the other side", () => {
    const stolen = card(1, MZONE, 3, { name: "Stolen Monster" });
    const snatch = card(0, SZONE, 4, { name: "Snatch Steal", equippedTo: { controller: 1, location: MZONE, sequence: 3 } });
    const links = resolveEquipLinks([seat(0, [], [null, null, null, null, snatch]), seat(1, [null, null, null, stolen], [])]);
    expect(links.links[0].hostKey).toBe("1:4:3");
    expect(links.byHost.get("1:4:3")).toHaveLength(1);
  });

  it("drops a link whose monster is no longer on the board", () => {
    const links = resolveEquipLinks([seat(0, [], [null, null, neo]), seat(1, [], [])]);
    expect(links.links).toEqual([]);
  });

  it("does not name a face-down monster", () => {
    const set = hidden(1, MZONE, 0);
    const equip = card(0, SZONE, 0, { name: "Axe of Despair", equippedTo: { controller: 1, location: MZONE, sequence: 0 } });
    const links = resolveEquipLinks([seat(0, [], [equip]), seat(1, [set], [])]);
    const link = links.links[0];
    expect(link.host).toBe(set);
    expect(equippedToText(link)).toBe("Equipped to a face-down monster");
    expect(equippedWithText([link])).toBe("Equipped with Axe of Despair");
  });

  it("uses a plain word for an equip card the viewer cannot name", () => {
    const equip = card(0, SZONE, 0, { equippedTo: { controller: 0, location: MZONE, sequence: 1 } });
    delete equip.name;
    const links = resolveEquipLinks([seat(0, [null, dragon], [equip]), seat(1, [], [])]);
    expect(equippedWithText(links.links)).toBe("Equipped with a card");
  });

  it("ignores hand cards and unknown seats", () => {
    const inHand = card(0, HAND, 0, { equippedTo: { controller: 0, location: MZONE, sequence: 1 } });
    const links = resolveEquipLinks([{ ...seat(0, [null, dragon], []), hand: [inHand] }, seat(1, [], [])]);
    expect(links.links).toEqual([]);
    expect(resolveEquipLinks([]).links).toEqual([]);
  });

  it("looks a card up by its own zone, so a stale copy still finds its role", () => {
    const links = resolveEquipLinks([seat(0, [null, dragon], [null, null, neo]), seat(1, [], [])]);
    const stale = { ...neo, equippedTo: undefined };
    expect(roleOfCard(links, stale)?.role).toBe("equip");
  });
});

describe("linksTouching", () => {
  it("returns the links that use any of the given zone keys", () => {
    const axe = card(0, SZONE, 0, { name: "Axe", equippedTo: { controller: 0, location: MZONE, sequence: 2 } });
    const other = card(0, MZONE, 2, { name: "Other" });
    const links = resolveEquipLinks([seat(0, [null, dragon, other], [axe, null, neo]), seat(1, [], [])]);
    expect(linksTouching(links, ["0:4:1"]).map((l) => l.equipKey)).toEqual(["0:8:2"]);
    expect(linksTouching(links, ["0:8:0", "0:4:9"]).map((l) => l.equipKey)).toEqual(["0:8:0"]);
    expect(linksTouching(links, ["1:4:1"])).toEqual([]);
    expect(linksTouching(links, [])).toEqual([]);
  });
});

describe("line geometry", () => {
  const box = { left: 100, top: 100, width: 60, height: 80 };

  it("leaves a box through the edge that faces the target", () => {
    expect(boxEdgePoint(box, { x: 130, y: 400 })).toEqual({ x: 130, y: 180 });
    expect(boxEdgePoint(box, { x: 130, y: -200 })).toEqual({ x: 130, y: 100 });
    expect(boxEdgePoint(box, { x: 500, y: 140 })).toEqual({ x: 160, y: 140 });
    expect(boxEdgePoint(box, { x: -300, y: 140 })).toEqual({ x: 100, y: 140 });
  });

  it("falls back to the centre when both centres are the same", () => {
    expect(boxEdgePoint(box, { x: 130, y: 140 })).toEqual({ x: 130, y: 140 });
  });

  it("draws a straight line between cards in one column", () => {
    const below = { left: 100, top: 220, width: 60, height: 80 };
    const line = equipLinePath(box, below);
    expect(line).not.toBeNull();
    expect(line!.from).toEqual({ x: 130, y: 180 });
    expect(line!.to).toEqual({ x: 130, y: 220 });
    expect(line!.d).toBe("M 130 180 L 130 220");
    expect(line!.mid).toEqual({ x: 130, y: 200 });
  });

  it("bends a little between cards in different columns", () => {
    const side = { left: 300, top: 220, width: 60, height: 80 };
    const line = equipLinePath(box, side)!;
    expect(line.d).toMatch(/^M [\d.-]+ [\d.-]+ Q [\d.-]+ [\d.-]+ [\d.-]+ [\d.-]+$/);
    expect(Number.isFinite(line.mid.x) && Number.isFinite(line.mid.y)).toBe(true);
  });

  it("draws no line when the cards overlap", () => {
    expect(equipLinePath(box, { left: 110, top: 110, width: 60, height: 80 })).toBeNull();
  });
});
