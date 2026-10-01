// Cards that do not work in multiplayer tables, under ADR-0002 (docs/adr/0002-multiplayer-duel-rules.md).
// Scenario catalog and script evidence: docs/specs/2026-09-30-multiplayer-card-scenarios.md
// Script evidence (cNNN.lua:line) for each entry: tests/scenarios/multiplayer/catalog.ts
// The test tests/scenarios/multiplayer/catalog.test.ts checks every code and every cited line
// against data/duel-engine-next.
// Alternate-art passcodes are NOT listed here. The deck check matches them through the
// `alias` column of cards.cdb (an alternate art has alias = original passcode).

/** Table kinds for deck validation. "1v1" is the classic duel and has no multiplayer list. */
export type MultiplayerTable = "1v1" | "tag" | "ffa3" | "ffa4";

export type MultiplayerFormat = "ffa3" | "ffa4" | "tag";

export type MultiplayerCategory =
  | "symmetry" // the script treats "me" and "the opponent" as two equal sides
  | "hand-swap" // the script reads or replaces both hands with one chooser per side
  | "control-swap" // the script swaps control between two named players
  | "turn-count" // a counter or a reset that counts "the opponent's turns"
  | "turn-order" // the script skips or adds a turn for one player
  | "alt-win" // the script ends the duel with Duel.Win ("you win"); decided forbidden in all formats (ADR-0002)
  | "global-state" // a per-player global flag table with two slots
  | "chooser" // the script asks "the opponent" to choose and assumes only one
  | "lp-reset"; // the script sets or compares the LP of exactly two players

export interface MultiplayerForbidden {
  code: number;
  name: string;
  category: MultiplayerCategory;
  reason: string;
  formats: MultiplayerFormat[];
}

const FFA: MultiplayerFormat[] = ["ffa3", "ffa4"];
const ALL: MultiplayerFormat[] = ["ffa3", "ffa4", "tag"];
const NO_RESULT = " A 'you win' effect has no defined result for the other players.";

export const MULTIPLAYER_FORBIDDEN: readonly MultiplayerForbidden[] = [
  // --- hand-swap: both hands, one chooser per side
  { code: 74519184, name: "Hand Destruction", category: "hand-swap", reason: "Turn player and one other player draw and discard. The other players do nothing.", formats: FFA },
  { code: 72892473, name: "Card Destruction", category: "hand-swap", reason: "Both hands go to the GY, but only two players draw.", formats: FFA },
  { code: 33508719, name: "Morphing Jar", category: "hand-swap", reason: "It discards all hands, but only two players draw 5 cards. In Tag, the partner discards and does not draw.", formats: ALL },
  { code: 14057297, name: "Multiple Destruction", category: "hand-swap", reason: "It reads two hands and two LP totals only. Other players are not part of the cost or the draw.", formats: ALL },
  { code: 17484499, name: "Exchange of the Spirit", category: "hand-swap", reason: "The script swaps the Deck and GY of exactly two players. The condition reads one GY on each side.", formats: ALL },
  // --- symmetry
  { code: 82301904, name: "Chaos Emperor Dragon - Envoy of the End", category: "symmetry", reason: "It sends both sides and damages both players. More than two players have no defined split.", formats: FFA },
  { code: 35059553, name: "Kaiser Colosseum", category: "symmetry", reason: "It compares the monster count of two sides to limit summons.", formats: FFA },
  { code: 98139712, name: "Skull Invitation", category: "symmetry", reason: "Damage goes by card owner to 'you' and 'the opponent' only.", formats: FFA },
  { code: 83555666, name: "Ring of Destruction", category: "symmetry", reason: "It damages the activator and one opponent. The opponent LP check reads one player.", formats: FFA },
  // --- turn-count
  { code: 72302403, name: "Swords of Revealing Light", category: "turn-count", reason: "It lasts for 3 'opponent turns'. In FFA, one round has more than one opponent turn.", formats: FFA },
  { code: 22804644, name: "Doom Virus Dragon", category: "turn-count", reason: "Its effect lasts 3 'opponent turns'.", formats: FFA },
  { code: 21208154, name: "The Wicked Avatar", category: "turn-count", reason: "Its effect lasts 2 'opponent turns'.", formats: FFA },
  { code: 22888900, name: "Grisaille Prison", category: "turn-count", reason: "Its effect lasts 2 'opponent turns'.", formats: FFA },
  { code: 23746827, name: "Million-Century Ice Prison", category: "turn-count", reason: "Its effect lasts 2 'opponent turns'.", formats: FFA },
  // --- turn-order
  { code: 18326736, name: "Tellarknight Ptolemaeus", category: "turn-order", reason: "It skips a turn. FFA turn order has no 'the opponent's turn'.", formats: FFA },
  { code: 23846921, name: "Arcana Force XXI - The World", category: "turn-order", reason: "It skips a turn. FFA turn order has no 'the opponent's turn'.", formats: FFA },
  { code: 37313786, name: "Gamble", category: "turn-order", reason: "It skips a turn. FFA turn order has no 'the opponent's turn'.", formats: FFA },
  { code: 6357341, name: "The Six Shinobi", category: "turn-order", reason: "It skips a turn. FFA turn order has no 'the opponent's turn'.", formats: FFA },
  { code: 92182447, name: "Mischief of the Time Goddess", category: "turn-order", reason: "It skips a turn. FFA turn order has no 'the opponent's turn'.", formats: FFA },
  // --- alt-win
  { code: 33396948, name: "Exodia the Forbidden One", category: "alt-win", reason: "It reads both hands and ends the duel with win, loss or draw for two sides.", formats: ALL },
  { code: 95308449, name: "Final Countdown", category: "alt-win", reason: "It keeps one counter for each of two players and then ends the duel.", formats: ALL },
  { code: 28566710, name: "Last Turn", category: "alt-win", reason: "It compares two players and ends the duel with win, loss or draw.", formats: ALL },
  { code: 37984331, name: "True Exodia", category: "alt-win", reason: "It ends the duel with a win for 'the opponent of the controller'. FFA and Tag have no single opponent.", formats: ALL },
  { code: 42776960, name: "Relay Soul", category: "alt-win", reason: `It ends the duel with a win for one saved player when its monster leaves the field.${NO_RESULT}`, formats: ALL },
  { code: 13893596, name: "Exodius the Ultimate Forbidden Lord", category: "alt-win", reason: `It ends the duel with a win for its controller when 5 Forbidden One monsters are in the GY.${NO_RESULT}`, formats: ALL },
  { code: 10000040, name: "Holactie the Creator of Light", category: "alt-win", reason: `The player who Special Summons it wins the duel.${NO_RESULT}`, formats: ALL },
  { code: 15862758, name: "Number iC1000: Numerounius Numerounia", category: "alt-win", reason: `It ends the duel with a win for its controller when it has not battled in an opponent turn.${NO_RESULT}`, formats: ALL },
  { code: 5008836, name: "Exodia, the Legendary Defender", category: "alt-win", reason: `It ends the duel with a win for its controller when it destroys a DARK Fiend of an opponent by battle.${NO_RESULT}`, formats: ALL },
  { code: 53334641, name: "Ghostrick Angel of Mischief", category: "alt-win", reason: `It ends the duel with a win for its controller when it has 10 Xyz Materials.${NO_RESULT}`, formats: ALL },
  { code: 6165656, name: "Number C88: Gimmick Puppet Disaster Leo", category: "alt-win", reason: `It ends the duel with a win for its controller in their turn when one opponent has 2000 LP or less.${NO_RESULT}`, formats: ALL },
  { code: 66765023, name: "Flying Elephant", category: "alt-win", reason: `It ends the duel with a win for its controller when it deals battle damage with a direct attack.${NO_RESULT}`, formats: ALL },
  { code: 69553552, name: "F.A. Winners", category: "alt-win", reason: `It ends the duel with a win for its controller when 3 of its banished cards have different names.${NO_RESULT}`, formats: ALL },
  { code: 77751766, name: "Summer Schoolwork Successful!", category: "alt-win", reason: `It ends the duel with a win for its controller when their Deck has 1 card or less after its effect.${NO_RESULT}`, formats: ALL },
  { code: 8062132, name: "Vennominaga the Deity of Poisonous Snakes", category: "alt-win", reason: `It ends the duel with a win for its controller when it has 3 counters.${NO_RESULT}`, formats: ALL },
  { code: 81171949, name: "Jackpot 7", category: "alt-win", reason: `It ends the duel with a win for its controller when 3 copies are banished.${NO_RESULT}`, formats: ALL },
  { code: 94212438, name: "Destiny Board", category: "alt-win", reason: `It ends the duel with a win for its controller when 4 Spirit Message cards are on their field.${NO_RESULT}`, formats: ALL },
  { code: 96637156, name: "Musical Sumo Dice Games", category: "alt-win", reason: `It ends the duel with a win for its controller when it gets its 7th Xyz Material.${NO_RESULT}`, formats: ALL },
  { code: 97795930, name: "Phantasm Spiral Assault", category: "alt-win", reason: `It ends the duel with a win for its controller when its counter reaches 3.${NO_RESULT}`, formats: ALL },
  { code: 48995978, name: "Number 88: Gimmick Puppet of Leo", category: "alt-win", reason: `It ends the duel with a win for its controller when it has 3 counters.${NO_RESULT}`, formats: ALL },
  // --- global-state
  { code: 27204311, name: "Nibiru, the Primal Being", category: "global-state", reason: "It counts summons in a flag for each of two players and reads the flag of 'the opponent'.", formats: FFA },
  { code: 94145021, name: "Droll & Lock Bird", category: "global-state", reason: "It keeps a two-slot table of draws for each player.", formats: FFA },
  // --- chooser
  { code: 57728570, name: "Crush Card Virus", category: "chooser", reason: "It reads the opponent hand, field and Deck, and asks one opponent to choose.", formats: FFA },
  // --- control-swap
  { code: 31036355, name: "Creature Swap", category: "control-swap", reason: "The script swaps control between the activator and one named opponent.", formats: FFA },
  { code: 15305240, name: "Creature Seizure", category: "control-swap", reason: "The script swaps control between the activator and one named opponent.", formats: FFA },
  { code: 30426226, name: "Switcheroroo", category: "control-swap", reason: "It needs equal monster counts on two sides and swaps all of them.", formats: FFA },
  { code: 13532663, name: "Dummy Golem", category: "control-swap", reason: "The script swaps control between the activator and a monster chosen by one named opponent.", formats: FFA },
  // --- lp-reset
  { code: 17178486, name: "Life Equalizer", category: "lp-reset", reason: "It sets the LP of one named opponent and compares two LP totals.", formats: FFA },
];

/**
 * Cards that stay legal but need a per-card multiplayer rule (product owner, 2026-10-01, ADR-0002).
 * The deck check does NOT use this list. The engine (Phase 3 Lua fold and the per-card multiplayer
 * scripts) must implement each rule. The scenario tests check it later: `engine` is "pending" until then.
 */
export interface MultiplayerCardRule {
  code: number;
  name: string;
  /** The decided rule, in one or two short sentences. */
  rule: string;
  engine: "pending";
}

const TRIBUTE_TO_FIELD =
  "The card goes to the field of the player whose monster was Tributed. In Tag, that player is an opposing member.";
const KAIJU_RULE = `${TRIBUTE_TO_FIELD} The summon with no Tribute needs a Kaiju on the field of any opponent and goes to your own field.`;

const PICK_ONE_COUNT =
  "In free-for-all, you pick one opponent when you activate it. The card compares you with that opponent only.";
const JOINED_COUNT = "In Tag, the fields of the two opposing members are joined, and the opposing team chooses from its joined field.";
const OPPONENT_FIELD_SUMMON =
  "The summoning player picks one opponent when they summon. The card or the tokens go to the field of that opponent. In Tag, that opponent is an opposing member.";

/**
 * Cards with an effect that Special Summons a card or tokens to the field of an opponent
 * (`Duel.SpecialSummon(..., tp, 1-tp, ...)` in the card script). Found by a scan of the card scripts.
 * Each one gets OPPONENT_FIELD_SUMMON. The scenario test checks that the scan finds no card that is missing here.
 */
const OPPONENT_FIELD_EFFECT_SUMMON: readonly (readonly [number, string])[] = [
  [131182, "Miracle Flipper"],
  [561300, "Poisonous Viper"],
  [1041278, "Branded Expulsion"],
  [3376703, "Arcana Force V - The Hierophant"],
  [3685372, "CXyz Gimmick Puppet Fanatix Machinix"],
  [6203182, "Two Toads with One Sting"],
  [7392745, "Chewbone"],
  [7623640, "Ceruli, Guru of Dark World"],
  [8837932, "Cubic Mandala"],
  [9400127, "Flogos, the Ogdoadic Boundless"],
  [10158145, "Knightmare Corruptor Iblee"],
  [11654067, "Fire Ejection"],
  [11677278, "Mimighoul Armor"],
  [13204145, "Mimighoul Maker"],
  [13452889, "Vector Scare Archfiend"],
  [13935001, "Lunalight Serenade Dance"],
  [14283055, "Concours de Cuisine (Culinary Confrontation)"],
  [14470845, "Ojama Duo"],
  [17000165, "Reptilianne Recoil"],
  [17228908, "Lost World"],
  [22404675, "Mithra the Thunder Vassal"],
  [22411609, "Volcanic Trooper"],
  [23920796, "Mimighoul Cerberus"],
  [25131968, "Ken the Warrior Dragon"],
  [26259179, "Couple of Aces"],
  [26364381, "Demiurge Ema"],
  [26913989, "Geistgrinder Golem"],
  [26964762, "Destiny HERO - Dark Angel"],
  [28062325, "Bamboo Scrap"],
  [29843091, "Ojama Trio"],
  [30069398, "Wall of Ivy"],
  [31313405, "Salamangreat Pyro Phoenix"],
  [31322640, "Allure Palace"],
  [33970665, "Guts of Steel"],
  [34968834, "Lucent, Netherlord of Dark World"],
  [36890111, "Mansion of the Dreadful Dolls"],
  [37129797, "Vampire Sucker"],
  [38041940, "Seed of Flame"],
  [38811586, "Albion the Sanctifire Dragon"],
  [39829561, "Destiny HERO - Departed"],
  [40343749, "House Duston"],
  [41141943, "Superheavy Samurai Transporter"],
  [42956963, "Nightmare Archfiends"],
  [43066927, "Mimighoul Fairy"],
  [44265115, "Brain Controller"],
  [44689688, "Jurrac Spinos"],
  [46647144, "World Legacy - \"World Lance\""],
  [47126872, "Space-Time Police"],
  [48228390, "Pyrite Knight"],
  [49966595, "Graydle Parasite"],
  [50415441, "Mimighoul Archfiend"],
  [52126602, "Gen the Diamond Tiger"],
  [52782439, "Exceptional Schedule"],
  [54191698, "Number 29: Mannequin Cat"],
  [54658815, "Remote Rebirth"],
  [55465441, "Give and Take"],
  [56562619, "Black Dragon Ninja"],
  [57357130, "Salamangreat Weasel"],
  [57844634, "Nimble Musasabi"],
  [59900655, "Gold Pride - Nytro Head"],
  [61665245, "Summon Sorceress"],
  [62767644, "Inferno of the Ashened"],
  [63013339, "Sky Striker Ace - Camellia"],
  [63086455, "Terrors of the Overroot"],
  [65477143, "Abyss Actor - Liberty Dramatist"],
  [65676461, "Number 32: Shark Drake"],
  [66094973, "Transforming Sphere"],
  [66661678, "Royal Knight of the Ice Barrier"],
  [67508932, "Timelord Progenitor Vorpgate"],
  [68378605, "Vodnika the Fountain Spirit"],
  [69811710, "Girsu, the Orcust Mekk-Knight"],
  [71015787, "Silent Wobby"],
  [71645242, "Black Garden"],
  [72554664, "Light of the Branded"],
  [73355951, "Alpha Summon"],
  [74440055, "Cactus Fighter"],
  [75524092, "Vicious Claw"],
  [76384284, "Trojan Gladiator Beast"],
  [76683171, "Worm Ugly"],
  [78610936, "Xyz Encore"],
  [78783557, "Veidos the Eruption Dragon of Extinction"],
  [80044027, "Mikanko Fire Dance"],
  [80551022, "Mimighoul Slime"],
  [80978111, "Flying \"C\""],
  [81003500, "Elemental HERO Necroid Shaman"],
  [81522098, "Mimighoul Dragon"],
  [81794107, "R.B. Lambda Cannon"],
  [82012319, "Scrap Golem"],
  [82773292, "Indulged Darklord"],
  [82933935, "Mimighoul Flower"],
  [82994509, "Horseytail"],
  [83778600, "Foolish Revival"],
  [85698115, "Terrors of the Afterroot"],
  [87170768, "Contact \"C\""],
  [88124568, "SPYRAL Double Agent"],
  [90884403, "Phantasmal Lord Ultimitl Bishbaalkin"],
  [93775296, "Reverse Reuse"],
  [93912845, "Revival Gift"],
  [93983867, "Trick Box"],
  [96857854, "Diamond Duston"],
  [99229085, "Gimmick Puppet Cattle Scream"],
  [99330325, "Interrupted Kaiju Slumber"],
];

export const MULTIPLAYER_CARD_RULES: readonly MultiplayerCardRule[] = [
  // --- Kaiju and Lava summon: Tribute a monster of an opponent, the card goes to that opponent's field
  { code: 55063751, name: "Gameciel, the Sea Turtle Kaiju", rule: KAIJU_RULE, engine: "pending" },
  { code: 28674152, name: "Radian, the Multidimensional Kaiju", rule: KAIJU_RULE, engine: "pending" },
  { code: 29726552, name: "Kumongous, the Sticky String Kaiju", rule: KAIJU_RULE, engine: "pending" },
  { code: 36956512, name: "Gadarla, the Mystery Dust Kaiju", rule: KAIJU_RULE, engine: "pending" },
  { code: 48770333, name: "Thunder King, the Lightningstrike Kaiju", rule: KAIJU_RULE, engine: "pending" },
  { code: 63941210, name: "Jizukiru, the Star Destroying Kaiju", rule: KAIJU_RULE, engine: "pending" },
  { code: 93332803, name: "Dogoran, the Mad Flame Kaiju", rule: KAIJU_RULE, engine: "pending" },
  { code: 102380, name: "Lava Golem", rule: `${TRIBUTE_TO_FIELD} It must Tribute 2 monsters of the same opponent.`, engine: "pending" },
  { code: 63014935, name: "Volcanic Queen", rule: TRIBUTE_TO_FIELD, engine: "pending" },
  { code: 25920413, name: "Alien Skull", rule: TRIBUTE_TO_FIELD, engine: "pending" },
  { code: 46565218, name: "Santa Claws", rule: TRIBUTE_TO_FIELD, engine: "pending" },
  { code: 33331231, name: "Surgical Striker - H.A.M.P.", rule: "In the procedure for an opponent field, the card goes to the field of the player whose monster was Tributed. In Tag, that player is an opposing member.", engine: "pending" },
  // --- Special Summon procedure to the field of an opponent (the card, or tokens, goes to the opponent's field)
  { code: 64203620, name: "Jormungardr the Nordic Serpent", rule: OPPONENT_FIELD_SUMMON, engine: "pending" },
  { code: 91697229, name: "Fenrir the Nordic Wolf", rule: OPPONENT_FIELD_SUMMON, engine: "pending" },
  { code: 75732622, name: "Grinder Golem", rule: OPPONENT_FIELD_SUMMON, engine: "pending" },
  { code: 82090807, name: "Fallen of Argyros", rule: OPPONENT_FIELD_SUMMON, engine: "pending" },
  { code: 10000080, name: "The Winged Dragon of Ra - Sphere Mode", rule: OPPONENT_FIELD_SUMMON, engine: "pending" },
  // --- count rules: one opponent in free-for-all, the joined opposing fields in Tag
  { code: 90669991, name: "Pineapple Blast", rule: `${PICK_ONE_COUNT} Only the monsters of that opponent are destroyed, and that opponent chooses their own monsters, as in 1v1. ${JOINED_COUNT} The count uses the monsters of both opposing members together.`, engine: "pending" },
  { code: 15693423, name: "Evenly Matched", rule: `${PICK_ONE_COUNT} Only the cards of that opponent are banished, and that opponent chooses their own cards, as in 1v1. ${JOINED_COUNT} The count uses the cards of both opposing members together.`, engine: "pending" },
  // --- effect that Special Summons a card or tokens to the field of an opponent
  ...OPPONENT_FIELD_EFFECT_SUMMON.map(([code, name]) => ({ code, name, rule: OPPONENT_FIELD_SUMMON, engine: "pending" as const })),
  // --- the other cards use the defaults
  { code: 44656491, name: "Messenger of Peace", rule: "You pay the 100 LP only in your own Standby Phase. In Tag, only the Standby Phase of your own duelist turn counts, and the team LP pays.", engine: "pending" },
  { code: 72405967, name: "Royal Tribute", rule: "Every opponent discards the monsters in their hand. As in 1v1, you discard yours too. In Tag, 'both players' means every duelist, the partner included (R-COMMON-EACH-PLAYER).", engine: "pending" },
  { code: 68005187, name: "Soul Exchange", rule: "You may target 1 monster of any opponent. This turn, a Tribute may use it as if you controlled it.", engine: "pending" },
  { code: 45986603, name: "Snatch Steal", rule: "The owner of the monster gains the 1000 LP, in the own Standby Phase of that owner. In Tag, the Standby Phase of the own duelist turn counts, and the team LP gains.", engine: "pending" },
];

const TABLE_FORMAT: Record<Exclude<MultiplayerTable, "1v1">, MultiplayerFormat> = {
  tag: "tag",
  ffa3: "ffa3",
  ffa4: "ffa4",
};

export const MULTIPLAYER_TABLE_LABEL: Record<Exclude<MultiplayerTable, "1v1">, string> = {
  tag: "2v2 Tag Duel",
  ffa3: "3-player free-for-all",
  ffa4: "4-player free-for-all",
};

const BY_CODE = new Map<number, MultiplayerForbidden>(MULTIPLAYER_FORBIDDEN.map((entry) => [entry.code, entry]));

/**
 * Find the forbidden entry for a card at a table. `alias` is the `alias` column of cards.cdb:
 * an alternate art has alias = passcode of the original card, so it matches the same entry.
 * Returns undefined for the "1v1" table.
 */
export function multiplayerForbiddenFor(
  table: MultiplayerTable,
  code: number,
  alias = 0,
): MultiplayerForbidden | undefined {
  if (table === "1v1") return undefined;
  const format = TABLE_FORMAT[table];
  const entry = BY_CODE.get(code) ?? (alias ? BY_CODE.get(alias) : undefined);
  return entry && entry.formats.includes(format) ? entry : undefined;
}
