import type Database from "better-sqlite3";
import type { DuelDeck } from "../duels/index.js";
import { isExtraDeckFrame } from "./card-catalog.js";
import { createSavedDeckService } from "./saved-decks.js";
import { createTournamentDuelService, TournamentDuelError } from "./tournament-duels.js";

/** A Main Deck holds at most this many cards in a draft tournament duel. */
export const DRAFT_DECK_MAIN_MAX = 60;
/** The Extra Deck and the Side Deck each hold at most this many cards. */
export const DRAFT_DECK_EXTRA_MAX = 15;
export const DRAFT_DECK_SIDE_MAX = 15;
/** The size a Main Deck is trimmed to; a bigger auto deck still plays. */
export const DRAFT_DECK_MAIN_TARGET = 40;

/** Test bots join drafts and tournaments with this Discord id prefix. They never get a saved deck. */
export const TEST_BOT_DISCORD_PREFIX = "bot_player_dev_";

export function isTestBotDiscordId(discordUserId: string): boolean {
  return discordUserId.startsWith(TEST_BOT_DISCORD_PREFIX);
}

/**
 * Splits a drafted pool into a deck. Extra Deck monsters go in extra, everything else in main.
 * A section over its limit puts the overflow in side (up to 15), so the deck stays one the duel
 * start accepts; cards that fit nowhere stay in the draft pool, where the deck editor finds them.
 * `catalogIds` are in pick order. Card codes are the catalog ids; the web layer maps them to
 * engine passcodes when it checks the deck.
 */
export function buildDraftDeck(cards: Array<{ catalogId: number; extra: boolean }>): DuelDeck {
  const main: number[] = [];
  const extra: number[] = [];
  const side: number[] = [];
  const overflow = (code: number) => {
    if (side.length < DRAFT_DECK_SIDE_MAX) side.push(code);
  };
  for (const card of cards) {
    if (card.extra) {
      if (extra.length < DRAFT_DECK_EXTRA_MAX) extra.push(card.catalogId);
      else overflow(card.catalogId);
    } else if (main.length < DRAFT_DECK_MAIN_MAX) main.push(card.catalogId);
    else overflow(card.catalogId);
  }
  return { main, extra, side };
}

/** How a registered draft deck stands against the size rules; null when nothing needs saying. */
export interface DraftDeckNote {
  /** `optional`: the deck plays as it is. `required`: the duel start would refuse it. */
  level: "optional" | "required";
  mainCount: number;
  message: string;
}

/**
 * The size note for a draft deck. Draft tournament duels are not checked for the 40-60 rule
 * (the pool is the limit): the duel start only needs a Main Deck of 5 to 60 cards. The deck editor
 * and the register call ask for 40 (or the whole main pool when it is smaller), so a deck above
 * 40 gets an optional hint and a deck below the minimum gets a required note.
 */
export function draftDeckNote(deck: DuelDeck, mainPoolCount: number): DraftDeckNote | null {
  const mainCount = deck.main.length;
  const required = Math.min(DRAFT_DECK_MAIN_TARGET, mainPoolCount);
  if (mainCount < required) {
    return {
      level: "required",
      mainCount,
      message: `Your draft deck has ${mainCount} main deck cards; edit it to ${required}.`,
    };
  }
  if (mainCount > DRAFT_DECK_MAIN_TARGET) {
    return {
      level: "optional",
      mainCount,
      message: `Your draft deck has ${mainCount} main deck cards. It plays as it is; you can trim it to ${DRAFT_DECK_MAIN_TARGET}.`,
    };
  }
  return null;
}

export interface DraftDeckService {
  /**
   * Saves a deck from every human player's picks for a finished draft. A player who already has
   * a deck for the draft, a bot, and a player with no picks are skipped. When the draft has a
   * tournament the new decks are also registered. Returns the owners that got a new deck.
   */
  saveForDraft(draftId: number): string[];
  /**
   * Saves the missing draft decks for every finished draft the user played in (this guild only).
   * Cheap when nothing is missing. Returns the draft ids that got a new deck.
   */
  ensureForUser(guildId: string, discordUserId: string): number[];
  /**
   * Registers each tournament player's draft deck on an entry that has no deck yet.
   * A registered deck is kept; a locked entry is left alone. Returns the player ids registered.
   */
  linkTournament(tournamentId: number, onlyPlayerId?: number): number[];
  /** The Main Deck cards the player drafted, for `draftDeckNote`. */
  mainPoolCount(draftId: number, playerId: number): number;
}

type DraftRow = { id: number; guild_id: string; name: string; tournament_id: number | null; ended_at: string | null; created_at: string };
type PickRow = { catalog_card_id: number; type: string | null; frame_type: string | null };

const MAX_NAME_LENGTH = 100;

function dayOf(draft: { ended_at?: string | null; created_at?: string }): string {
  const raw = draft.ended_at ?? draft.created_at;
  if (!raw) return "";
  const parsed = new Date(raw.includes("T") || raw.endsWith("Z") ? raw : `${raw.replace(" ", "T")}Z`);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

/** "<draft name> draft, 2026-10-03"; a name that already says draft is not doubled. */
export function draftDeckName(draft: { name: string; ended_at?: string | null; created_at?: string }): string {
  const suffix = dayOf(draft);
  const base = draft.name.trim() || "Draft";
  const tail = suffix ? `, ${suffix}` : "";
  const label = /draft/i.test(base) ? base : `${base} draft`;
  const room = MAX_NAME_LENGTH - tail.length;
  return `${label.length > room ? label.slice(0, room).trimEnd() : label}${tail}`;
}

export function createDraftDeckService(db: Database.Database): DraftDeckService {
  const selectDraft = db.prepare<[number], DraftRow>(
    "select id, guild_id, name, tournament_id, ended_at, created_at from drafts where id = ? and status = 'completed'",
  );
  const selectHumans = db.prepare<[number], { player_id: number; discord_user_id: string }>(
    `select dp.player_id, p.discord_user_id
     from draft_players dp
     inner join players p on p.id = dp.player_id
     where dp.draft_id = ?
     order by dp.joined_at asc, dp.rowid asc`,
  );
  const selectPicks = db.prepare<[number, number], PickRow>(
    `select dc.catalog_card_id, cc.type, cc.frame_type
     from draft_picks dp
     inner join draft_cards dc on dc.id = dp.draft_card_id
     left join card_catalog cc on cc.ygoprodeck_id = dc.catalog_card_id
     where dp.draft_id = ? and dp.player_id = ?
     order by dp.id asc`,
  );
  // Finished drafts the user played in with no saved deck yet (this guild only).
  const selectMissing = db.prepare<[string, string, string], { id: number }>(
    `select d.id
     from drafts d
     inner join draft_players dp on dp.draft_id = d.id
     inner join players p on p.id = dp.player_id
     where d.guild_id = ? and d.status = 'completed' and p.guild_id = d.guild_id and p.discord_user_id = ?
       and not exists (
         select 1 from saved_decks s
         where s.guild_id = d.guild_id and s.owner_user_id = ? and s.draft_id = d.id
       )
       and exists (select 1 from draft_picks k where k.draft_id = d.id and k.player_id = dp.player_id)
     order by d.id`,
  );
  const selectDraftTournament = db.prepare<[number], { tournament_id: number | null }>(
    "select tournament_id from drafts where id = ?",
  );
  const selectUnregistered = db.prepare<[number], { player_id: number; discord_user_id: string }>(
    `select tp.player_id, p.discord_user_id
     from tournament_participants tp
     inner join players p on p.id = tp.player_id
     where tp.tournament_id = ? and tp.deck_json is null and tp.deck_locked_at is null
     order by tp.joined_at asc, tp.rowid asc`,
  );
  const selectTournamentGuild = db.prepare<[number], { guild_id: string; draft_id: number | null }>(
    `select t.guild_id, (select d.id from drafts d where d.tournament_id = t.id order by d.id limit 1) as draft_id
     from tournaments t where t.id = ?`,
  );

  const picksOf = (draftId: number, playerId: number) =>
    selectPicks.all(draftId, playerId).map((row) => ({
      catalogId: row.catalog_card_id,
      // A card missing from the catalog counts as Main, like the web pool loader.
      extra: row.type != null && isExtraDeckFrame({ type: row.type, frameType: row.frame_type ?? "" }),
    }));

  const service: DraftDeckService = {
    mainPoolCount(draftId, playerId) {
      return picksOf(draftId, playerId).filter((card) => !card.extra).length;
    },

    linkTournament(tournamentId, onlyPlayerId) {
      const info = selectTournamentGuild.get(tournamentId);
      if (!info || info.draft_id === null) return [];
      const saved = createSavedDeckService(db);
      const duels = createTournamentDuelService(db);
      const linked: number[] = [];
      for (const row of selectUnregistered.all(tournamentId)) {
        if (onlyPlayerId !== undefined && row.player_id !== onlyPlayerId) continue;
        if (isTestBotDiscordId(row.discord_user_id)) continue;
        const deck = saved.findByDraft(info.guild_id, row.discord_user_id, info.draft_id);
        if (!deck) continue;
        try {
          duels.registerDeck({ tournamentId, playerId: row.player_id, savedDeckId: deck.id, deck: deck.deck });
          linked.push(row.player_id);
        } catch (error) {
          // A closed tournament or a locked deck is not a failure of the draft.
          if (!(error instanceof TournamentDuelError)) throw error;
        }
      }
      return linked;
    },

    saveForDraft(draftId) {
      const draft = selectDraft.get(draftId);
      if (!draft) return [];
      const saved = createSavedDeckService(db);
      const created: string[] = [];
      const run = db.transaction(() => {
        for (const human of selectHumans.all(draftId)) {
          if (isTestBotDiscordId(human.discord_user_id)) continue;
          if (saved.findByDraft(draft.guild_id, human.discord_user_id, draftId)) continue;
          const cards = picksOf(draftId, human.player_id);
          if (cards.length === 0) continue;
          saved.create(draft.guild_id, human.discord_user_id, {
            name: draftDeckName(draft),
            mode: "normal",
            deck: buildDraftDeck(cards),
            draftId,
          });
          created.push(human.discord_user_id);
        }
        const tournamentId = selectDraftTournament.get(draftId)?.tournament_id ?? null;
        if (tournamentId !== null) service.linkTournament(tournamentId);
      });
      run();
      return created;
    },

    ensureForUser(guildId, discordUserId) {
      const missing = selectMissing.all(guildId, discordUserId, discordUserId);
      for (const { id } of missing) service.saveForDraft(id);
      return missing.map((row) => row.id);
    },
  };
  return service;
}
