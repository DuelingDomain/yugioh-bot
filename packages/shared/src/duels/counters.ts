/**
 * Checked static catalog from the owner-approved status/counter demo (2026-10-23).
 * Names, IDs and families: .fx-demo/status-counters/data.js.
 * Family labels, colors and 17 primary glyphs: .fx-demo/status-counters/index.html.
 * data.js SHA-256: 2d08507a26c7ecd373448b75aa34e2faa6b3a82ef7a4d1e671c28780dc740461
 * index.html SHA-256: ea06fc925391cc7b24e48165692f8f32302cca36d3f48f1490adecb24d834a6c
 *
 * All 134 IDs and names match data/duel-engine/strings.conf. Shared COUNTER_*
 * IDs were also checked against card-scripts/card_counter_constants.lua, and
 * counter flags against card-scripts/constant.lua. Keep the complete ID,
 * including COUNTER_WITHOUT_PERMIT (0x1000) and COUNTER_NEED_ENABLE (0x2000).
 * COUNTER_EC (0x217) exists only in the Lua constants and uses the unknown-ID
 * fallback until the catalog is deliberately extended.
 */

/** Existing wire shape, named so server and browser share the same contract. */
export interface DuelCounter {
  /** Complete engine ID, including counter flags. */
  type: number;
  count: number;
}

/**
 * SVG interiors for a 24 x 24 viewBox with fill="currentColor".
 * Primary glyph paths are copied exactly from the demo. The named family's
 * generic glyph follows the demo's FG.loot fallback; its initials remain a
 * presentation choice for a future renderer.
 */
export const DUEL_COUNTER_GLYPHS = {
  arcane: "<path d=\"M12 2l2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4z\"/>",
  combat: "<path d=\"M3 5l9 7-9 7zM13 5l9 7-9 7z\"/>",
  toxic: "<path d=\"M12 2C8 8 5 11.500 5 15a7 7 0 0014 0c0-3.500-3-7-7-13z\"/>",
  nature: "<path d=\"M4 20C4 10 10 4 21 3c0 11-6 17-15 17z\"/><path d=\"M4 21l9-9\" stroke=\"#0a0e1c\" stroke-width=\"1.600\" fill=\"none\"/>",
  machine: "<circle cx=\"12\" cy=\"12\" r=\"5.500\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"3.500\"/><circle cx=\"12\" cy=\"12\" r=\"9.500\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"3\" stroke-dasharray=\"3.100 3.100\"/>",
  timer: "<circle cx=\"12\" cy=\"12\" r=\"9.500\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.400\"/><path d=\"M12 6v6l4 2.500\" stroke=\"currentColor\" stroke-width=\"2.400\" fill=\"none\" stroke-linecap=\"round\"/>",
  loot: "<circle cx=\"12\" cy=\"12\" r=\"9.500\"/><circle cx=\"12\" cy=\"12\" r=\"4.500\" fill=\"#0a0e1c\"/>",
  named: "<circle cx=\"12\" cy=\"12\" r=\"9.500\"/><circle cx=\"12\" cy=\"12\" r=\"4.500\" fill=\"#0a0e1c\"/>",
  spell: "<path d=\"M12 2l2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4z\"/>",
  a: "<path d=\"M12 2L2 22h5l1.600-4h6.800l1.600 4h5zM12 9.500l2.200 5.500H9.800z\" fill-rule=\"evenodd\"/>",
  predator: "<path d=\"M2 6h20l-2 5-2.500-3-2 6-2.500-6-2.500 6-2-6L4 11z\"/><path d=\"M5 19h14\" stroke=\"currentColor\" stroke-width=\"2.400\" stroke-linecap=\"round\"/>",
  fog: "<path d=\"M7 19a4.500 4.500 0 010-9 6 6 0 0111.500-1.500A4.800 4.800 0 0118 19z\"/>",
  kaiju: "<path d=\"M4 3c3.500 5 4.500 11 3 18-3.500-4-4.500-11-3-18zM11 2c3.500 6 4.500 13 3 20-3.500-5-4.500-13-3-20zM18 4c2.500 5 2.500 11 0 16-2.500-4-2.500-11 0-16z\"/>",
  bes: "<path d=\"M12 2l9 5v10l-9 5-9-5V7zm0 5l-4.500 2.500v5L12 17l4.500-2.500v-5z\" fill-rule=\"evenodd\"/>",
  resonance: "<circle cx=\"12\" cy=\"12\" r=\"3\"/><g fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.200\"><circle cx=\"12\" cy=\"12\" r=\"6.500\"/><circle cx=\"12\" cy=\"12\" r=\"10\" opacity=\".6\"/></g>",
  bushido: "<path d=\"M21 2l1 1-11 12-2-2zM8 14l2 2-2.500 1.500L5 21l-2-2 3.500-2.500z\"/>",
  venom: "<path d=\"M12 2C8 8 5 11.500 5 15a7 7 0 0014 0c0-3.500-3-7-7-13z\"/>",
  ice: "<g stroke=\"currentColor\" stroke-width=\"2.400\" stroke-linecap=\"round\" fill=\"none\"><path d=\"M12 2v20M3.300 7l17.400 10M3.300 17L20.700 7\"/></g>",
  feather: "<path d=\"M21 2C11 2 5 8 5 14l-3 8 1.500.5L6.500 17C14 17 20 11 21 2z\"/>",
  cubic: "<path d=\"M12 2l9 5v10l-9 5-9-5V7z\"/><path d=\"M12 12l9-5M12 12L3 7M12 12v10\" stroke=\"#0a0e1c\" stroke-width=\"1.600\" fill=\"none\"/>",
  wedge: "<path d=\"M3 3h18l-9 19z\"/>",
  clock: "<circle cx=\"12\" cy=\"12\" r=\"9.500\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.400\"/><path d=\"M12 6v6l4 2.500\" stroke=\"currentColor\" stroke-width=\"2.400\" fill=\"none\" stroke-linecap=\"round\"/>",
  signal: "<circle cx=\"12\" cy=\"15\" r=\"2.600\"/><path d=\"M6.500 10a7.700 7.700 0 0111 0M3 6.500a12.700 12.700 0 0118 0\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.300\" stroke-linecap=\"round\"/>",
  morph: "<path d=\"M12 2l10 10-10 10L2 12z\"/><path d=\"M12 7l5 5-5 5-5-5z\" fill=\"#0a0e1c\"/>",
  spellstone: "<path d=\"M6 3h12l4 6-10 13L2 9z\"/>",
} as const;

export type DuelCounterGlyph = keyof typeof DUEL_COUNTER_GLYPHS;

/** Family colors and labels copied from the approved demo. */
export const DUEL_COUNTER_FAMILIES = {
  arcane: { name: "Arcane", description: "spells and magic", color: "#9b7eff", glyph: "arcane" },
  combat: { name: "Combat", description: "battle and power", color: "#ef6a5a", glyph: "combat" },
  toxic: { name: "Toxic", description: "poison and venom", color: "#b7e04a", glyph: "toxic" },
  nature: { name: "Nature", description: "ice, plants, weather", color: "#3fc7b4", glyph: "nature" },
  machine: { name: "Machine", description: "gears and tech", color: "#7fa8d8", glyph: "machine" },
  timer: { name: "Timer", description: "turns, clocks, time", color: "#f4d690", glyph: "timer" },
  loot: { name: "Other", description: "resources and misc", color: "#f08fb0", glyph: "loot" },
  named: { name: "Card-specific", description: "named after one card", color: "#e8e0cc", glyph: "named" },
} as const satisfies Record<string, {
  readonly name: string;
  readonly description: string;
  readonly color: string;
  readonly glyph: DuelCounterGlyph;
}>;

export type DuelCounterFamily = keyof typeof DUEL_COUNTER_FAMILIES;

export interface DuelCounterMetadata {
  /** Stable readable key; duplicate names include their complete hex ID. */
  readonly key: string;
  readonly name: string;
  readonly family: DuelCounterFamily;
  readonly glyph: DuelCounterGlyph;
}

/**
 * Exact numeric engine IDs map to metadata. Only the demo's 17 primary types
 * have their own glyph key; all other types use their family's generic glyph.
 * Repeated names such as Maiden and G Golem intentionally retain both IDs.
 */
export const DUEL_COUNTER_CATALOG: Readonly<Partial<Record<number, DuelCounterMetadata>>> = {
  0x1: { key: "spell", name: "Spell Counter", family: "arcane", glyph: "spell" },
  0x100e: { key: "a", name: "A-Counter", family: "combat", glyph: "a" },
  0x1041: { key: "predator", name: "Predator Counter", family: "combat", glyph: "predator" },
  0x1019: { key: "fog", name: "Fog Counter", family: "nature", glyph: "fog" },
  0x37: { key: "kaiju", name: "Kaiju Counter", family: "combat", glyph: "kaiju" },
  0x1f: { key: "bes", name: "Counter (\"B.E.S.\")", family: "named", glyph: "bes" },
  0x211: { key: "resonance", name: "Resonance Counter", family: "arcane", glyph: "resonance" },
  0x3: { key: "bushido", name: "Bushido Counter", family: "combat", glyph: "bushido" },
  0x1009: { key: "venom", name: "Venom Counter", family: "toxic", glyph: "venom" },
  0x1015: { key: "ice", name: "Ice Counter", family: "nature", glyph: "ice" },
  0x10: { key: "feather", name: "Black Feather Counter", family: "combat", glyph: "feather" },
  0x1038: { key: "cubic", name: "Cubic Counter", family: "machine", glyph: "cubic" },
  0x8: { key: "morph", name: "Morph Counter", family: "arcane", glyph: "morph" },
  0x16: { key: "spellstone", name: "Spellstone Counter", family: "arcane", glyph: "spellstone" },
  0x1b: { key: "clock", name: "Clock Counter", family: "timer", glyph: "clock" },
  0x35: { key: "symphonic", name: "Symphonic Counter", family: "arcane", glyph: "arcane" },
  0x1002: { key: "wedge", name: "Wedge Counter", family: "arcane", glyph: "wedge" },
  0x1148: { key: "signal", name: "Signal Counter", family: "machine", glyph: "signal" },
  0x5: { key: "shine", name: "Shine Counter", family: "arcane", glyph: "arcane" },
  0xf: { key: "worm", name: "Worm Counter", family: "toxic", glyph: "toxic" },
  0x25: { key: "chronicle", name: "Chronicle Counter", family: "timer", glyph: "timer" },
  0x33: { key: "yosen", name: "Yosen Counter", family: "arcane", glyph: "arcane" },
  0x148: { key: "summon", name: "Summon Counter", family: "timer", glyph: "timer" },
  0x1024: { key: "string", name: "String Counter", family: "machine", glyph: "machine" },
  0x1101: { key: "hallucination", name: "Hallucination Counter", family: "arcane", glyph: "arcane" },
  0x1149: { key: "venemy", name: "Venemy Counter", family: "toxic", glyph: "toxic" },
  0x4: { key: "psychic", name: "Psychic Counter", family: "arcane", glyph: "arcane" },
  0x6: { key: "crystal", name: "Crystal Counter", family: "arcane", glyph: "arcane" },
  0x7: { key: "colosseum-cage-of-the-gladiator-beasts", name: "Counter (\"Colosseum - Cage of the Gladiator Beasts\")", family: "named", glyph: "named" },
  0xa: { key: "genex", name: "Genex Counter", family: "arcane", glyph: "arcane" },
  0xb: { key: "ancient-city", name: "Counter (\"Ancient City\")", family: "named", glyph: "named" },
  0xc: { key: "thunder", name: "Thunder Counter", family: "arcane", glyph: "arcane" },
  0xd: { key: "greed", name: "Greed Counter", family: "loot", glyph: "loot" },
  0x11: { key: "hyper-venom", name: "Hyper Venom Counter", family: "toxic", glyph: "toxic" },
  0x12: { key: "karakuri", name: "Karakuri Counter", family: "machine", glyph: "machine" },
  0x13: { key: "chaos", name: "Chaos Counter", family: "arcane", glyph: "arcane" },
  0x14: { key: "miracle-jurassic-egg", name: "Counter (\"Miracle Jurassic Egg\")", family: "named", glyph: "named" },
  0x17: { key: "nut", name: "Nut Counter", family: "loot", glyph: "loot" },
  0x18: { key: "flower", name: "Flower Counter", family: "nature", glyph: "nature" },
  0x1a: { key: "payback", name: "Payback Counter", family: "combat", glyph: "combat" },
  0x1c: { key: "d", name: "D Counter", family: "arcane", glyph: "arcane" },
  0x1d: { key: "junk", name: "Junk Counter", family: "machine", glyph: "machine" },
  0x1e: { key: "gate", name: "Gate Counter", family: "machine", glyph: "machine" },
  0x20: { key: "plant", name: "Plant Counter", family: "nature", glyph: "nature" },
  0x22: { key: "dragonic", name: "Dragonic Counter", family: "combat", glyph: "combat" },
  0x23: { key: "ocean", name: "Ocean Counter", family: "nature", glyph: "nature" },
  0x26: { key: "metal-shooter", name: "Counter (\"Metal Shooter\")", family: "named", glyph: "named" },
  0x27: { key: "des-mosquito", name: "Counter (\"Des Mosquito\")", family: "named", glyph: "named" },
  0x28: { key: "dark-catapulter", name: "Counter (\"Dark Catapulter\")", family: "named", glyph: "named" },
  0x29: { key: "balloon-lizard", name: "Counter (\"Balloon Lizard\")", family: "named", glyph: "named" },
  0x2b: { key: "destiny", name: "Destiny Counter", family: "loot", glyph: "loot" },
  0x2c: { key: "you-got-it-boss", name: "You Got It Boss! Counter", family: "loot", glyph: "loot" },
  0x2d: { key: "kickfire", name: "Counter (\"Kickfire\")", family: "named", glyph: "named" },
  0x2e: { key: "shark", name: "Shark Counter", family: "loot", glyph: "loot" },
  0x2f: { key: "pumpkin", name: "Pumpkin Counter", family: "nature", glyph: "nature" },
  0x30: { key: "hi-five-the-sky", name: "Hi-Five the Sky Counter", family: "loot", glyph: "loot" },
  0x31: { key: "rising-sun", name: "Rising Sun Counter", family: "timer", glyph: "timer" },
  0x32: { key: "balloon", name: "Balloon Counter", family: "loot", glyph: "loot" },
  0x34: { key: "boxer", name: "Counter (\"BOXer\")", family: "named", glyph: "named" },
  0x36: { key: "performage", name: "Performage Counter", family: "arcane", glyph: "arcane" },
  0x40: { key: "number-51-finisher-the-strong-arm", name: "Counter (\"Number 51: Finisher the Strong Arm\")", family: "named", glyph: "named" },
  0x42: { key: "fire-cracker", name: "Counter (\"Fire Cracker\")", family: "named", glyph: "named" },
  0x43: { key: "defect", name: "Defect Counter", family: "machine", glyph: "machine" },
  0x44: { key: "linkbelt-wall-dragon", name: "Counter (\"Linkbelt Wall Dragon\")", family: "named", glyph: "named" },
  0x46: { key: "gouki-cage-match", name: "Counter (\"Gouki Cage Match\")", family: "named", glyph: "named" },
  0x47: { key: "limit-code", name: "Counter (\"Limit Code\")", family: "named", glyph: "named" },
  0x48: { key: "link-turret", name: "Counter (\"Link Turret\")", family: "named", glyph: "named" },
  0x4a: { key: "athlete", name: "Athlete Counter", family: "combat", glyph: "combat" },
  0x59: { key: "otoshidamashi", name: "Otoshidamashi Counter", family: "loot", glyph: "loot" },
  0x147: { key: "borrel", name: "Borrel Counter", family: "machine", glyph: "machine" },
  0x14a: { key: "turntrooper", name: "Counter (\"Turntrooper\")", family: "named", glyph: "named" },
  0x14b: { key: "battlewasp-nest", name: "Counter (\"Battlewasp Nest\")", family: "named", glyph: "named" },
  0x14c: { key: "firewall-dragon-darkfluid", name: "Counter (\"Firewall Dragon Darkfluid\")", family: "named", glyph: "named" },
  0x14d: { key: "seraphim-papillon", name: "Counter (\"Seraphim Papillon\")", family: "named", glyph: "named" },
  0x14e: { key: "cauldron-of-the-old-man", name: "Counter (\"Cauldron of the Old Man\")", family: "named", glyph: "named" },
  0x14f: { key: "world-legacys-continuation", name: "Counter (\"World Legacy's Continuation\")", family: "named", glyph: "named" },
  0x200: { key: "pendulum-of-souls", name: "Counter (\"Pendulum of Souls\")", family: "named", glyph: "named" },
  0x201: { key: "fire-fist", name: "Fire Fist Counter", family: "arcane", glyph: "arcane" },
  0x202: { key: "phantasm", name: "Phantasm Counter", family: "arcane", glyph: "arcane" },
  0x203: { key: "hinezumi-hanabi", name: "Counter (\"Hinezumi Hanabi\")", family: "named", glyph: "named" },
  0x204: { key: "ursarctic-big-dipper", name: "Counter (\"Ursarctic Big Dipper\")", family: "named", glyph: "named" },
  0x205: { key: "war-rock-ordeal", name: "Counter (\"War Rock Ordeal\")", family: "named", glyph: "named" },
  0x206: { key: "sacred-scrolls-of-the-gizmek-legend", name: "Counter (\"Sacred Scrolls of the Gizmek Legend\")", family: "named", glyph: "named" },
  0x207: { key: "emperors-key", name: "Emperor's Key Counter", family: "loot", glyph: "loot" },
  0x208: { key: "life-shaver", name: "Counter (\"Life Shaver\")", family: "named", glyph: "named" },
  0x209: { key: "ursarctic-radiation", name: "Counter (\"Ursarctic Radiation\")", family: "named", glyph: "named" },
  0x20a: { key: "piece", name: "Piece Counter", family: "loot", glyph: "loot" },
  0x20b: { key: "forge-a-new-future", name: "Counter (\"Forge a New Future\")", family: "named", glyph: "named" },
  0x20c: { key: "g-golem-0x20c", name: "G Golem Counter", family: "machine", glyph: "machine" },
  0x20d: { key: "gunkan-suship-catch-of-the-day", name: "Counter (\"Gunkan Suship Catch-of-the-Day\")", family: "named", glyph: "named" },
  0x20e: { key: "combat-wheel", name: "Counter (\"Combat Wheel\")", family: "named", glyph: "named" },
  0x20f: { key: "totem-pole", name: "Counter (\"Totem Pole\")", family: "named", glyph: "named" },
  0x210: { key: "veda-upanishad", name: "Counter (\"Veda Upanishad\")", family: "named", glyph: "named" },
  0x212: { key: "access", name: "Access Counter", family: "machine", glyph: "machine" },
  0x213: { key: "schoolwork", name: "Schoolwork Counter", family: "timer", glyph: "timer" },
  0x1021: { key: "guard", name: "Guard Counter", family: "combat", glyph: "combat" },
  0x102a: { key: "magic-reflector", name: "Counter (\"Magic Reflector\")", family: "named", glyph: "named" },
  0x1039: { key: "zushin", name: "Zushin Counter", family: "nature", glyph: "nature" },
  0x1045: { key: "scale", name: "Scale Counter", family: "arcane", glyph: "arcane" },
  0x1049: { key: "patrol", name: "Patrol Counter", family: "timer", glyph: "timer" },
  0x1090: { key: "maiden-0x1090", name: "Maiden Counter", family: "arcane", glyph: "arcane" },
  0x1207: { key: "burnup", name: "Burnup Counter", family: "combat", glyph: "combat" },
  0x1208: { key: "bunny-ear", name: "Bunny Ear Counter", family: "loot", glyph: "loot" },
  0x1209: { key: "deranged", name: "Deranged Counter", family: "toxic", glyph: "toxic" },
  0x55: { key: "hammer", name: "Hammer Counter", family: "combat", glyph: "combat" },
  0x90: { key: "maiden-0x90", name: "Maiden Counter", family: "arcane", glyph: "arcane" },
  0x91: { key: "speed", name: "Speed Counter", family: "timer", glyph: "timer" },
  0x92: { key: "plasma", name: "Plasma Counter", family: "machine", glyph: "machine" },
  0x93: { key: "sacred-beast", name: "Sacred Beast Counter", family: "arcane", glyph: "arcane" },
  0x94: { key: "earthbound-immortal", name: "Earthbound Immortal Counter", family: "arcane", glyph: "arcane" },
  0x95: { key: "crest", name: "Crest Counter", family: "arcane", glyph: "arcane" },
  0x96: { key: "battle-buffer", name: "Battle Buffer Counter", family: "combat", glyph: "combat" },
  0x99: { key: "full-moon", name: "Full Moon Counter", family: "timer", glyph: "timer" },
  0xfb: { key: "trickstar", name: "Trickstar Counter", family: "arcane", glyph: "arcane" },
  0x103: { key: "medal", name: "Medal Counter", family: "loot", glyph: "loot" },
  0x107: { key: "gearspring", name: "Gearspring Counter", family: "machine", glyph: "machine" },
  0x577: { key: "hydradrive", name: "Hydradrive Counter", family: "machine", glyph: "machine" },
  0x584: { key: "ai-ai-wall", name: "Counter (Ai Ai Wall)", family: "loot", glyph: "loot" },
  0x1096: { key: "protection", name: "Protection Counter", family: "combat", glyph: "combat" },
  0x1097: { key: "des", name: "Des Counter", family: "combat", glyph: "combat" },
  0x1098: { key: "chain", name: "Chain Counter", family: "timer", glyph: "timer" },
  0x109a: { key: "scab", name: "Scab Counter", family: "toxic", glyph: "toxic" },
  0x1100: { key: "aura", name: "Aura Counter", family: "arcane", glyph: "arcane" },
  0x1102: { key: "gear", name: "Gear Counter", family: "machine", glyph: "machine" },
  0x1104: { key: "thorn", name: "Thorn Counter", family: "toxic", glyph: "toxic" },
  0x1105: { key: "turn", name: "Turn Counter", family: "timer", glyph: "timer" },
  0x1106: { key: "shield", name: "Shield Counter", family: "combat", glyph: "combat" },
  0x1107: { key: "prey", name: "Prey Counter", family: "toxic", glyph: "toxic" },
  0x1108: { key: "vaccine", name: "Vaccine Counter", family: "toxic", glyph: "toxic" },
  0x1109: { key: "life-star", name: "Life Star Counter", family: "arcane", glyph: "arcane" },
  0x1110: { key: "beacon", name: "Beacon Counter", family: "machine", glyph: "machine" },
  0x1112: { key: "disturbance", name: "Disturbance Counter", family: "arcane", glyph: "arcane" },
  0x1113: { key: "charge", name: "Charge Counter", family: "machine", glyph: "machine" },
  0x1115: { key: "g-golem-0x1115", name: "G Golem Counter", family: "machine", glyph: "machine" },
};

/** Resolve full engine IDs, including flags; future IDs remain distinguishable. */
export function getDuelCounterMetadata(type: number): DuelCounterMetadata {
  return DUEL_COUNTER_CATALOG[type] ?? {
    key: `counter-0x${type.toString(16)}`,
    name: `Counter (0x${type.toString(16)})`,
    family: "loot",
    glyph: "loot",
  };
}
