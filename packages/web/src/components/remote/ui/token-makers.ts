/**
 * Cards that give a known token, from their scripts (data/duel-engine/card-scripts) and cards.cdb.
 * `id` is the real token passcode: its art comes from the card image route. ATK/DEF are the cdb values (`ask`: they depend on the game).
 * `auto` cards make their tokens when they are activated or placed face up; the others (the effect is a Graveyard trigger) only offer a chip.
 * `opponent`: the tokens go to the opponent's field.
 */
export type TokenMaker = { token: string; id: number; atk: number; def: number; position: "attack" | "defense"; count: number; auto?: true; opponent?: true; ask?: true };

/** Keyed by the lower-case name of the card that gives the token. */
export const TOKEN_MAKERS: Record<string, TokenMaker> = {
  "scapegoat": { token: "Sheep Token", id: 73915052, atk: 0, def: 0, position: "defense", count: 4, auto: true },
  "nibiru, the primal being": { token: "Primal Being Token", id: 27204312, atk: 0, def: 0, position: "attack", count: 1, auto: true, opponent: true, ask: true },
  "ojama trio": { token: "Ojama Token", id: 29843092, atk: 0, def: 1000, position: "defense", count: 3, auto: true, opponent: true },
  "stray lambs": { token: "Lamb Token", id: 60764582, atk: 0, def: 0, position: "defense", count: 2, auto: true },
  "multiplication of ants": { token: "Army Ant Token", id: 22493812, atk: 500, def: 1200, position: "attack", count: 2, auto: true },
  "hippo carnival": { token: "Hippo Token", id: 18027139, atk: 0, def: 0, position: "attack", count: 3, auto: true },
  "fires of doomsday": { token: "Doomsday Token", id: 46173680, atk: 0, def: 0, position: "defense", count: 2, auto: true },
  "dandylion": { token: "Fluff Token", id: 15341822, atk: 0, def: 0, position: "defense", count: 2 },
  "dandy whitelion": { token: "White Fluff Token", id: 36629636, atk: 0, def: 0, position: "defense", count: 3 },
};

/** Real art by lower-case token name, for tokens made by hand (a generic token whose name is a known one). */
export const TOKEN_ART: Record<string, number> = Object.fromEntries(Object.values(TOKEN_MAKERS).map(maker => [maker.token.toLowerCase(), maker.id]));

/** The real token card shown when a token has no art of its own: the Sheep Token, the best known official token. A token never shows a drawn stand-in. */
export const DEFAULT_TOKEN_ART = 73915052;
