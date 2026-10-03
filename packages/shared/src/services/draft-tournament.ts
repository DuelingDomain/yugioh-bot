import type Database from "better-sqlite3";
import type { DraftConfig } from "../types/index.js";
import type { TournamentFormat } from "./tournaments.js";
import { generateWebSlug } from "../util/web-slug.js";
import { createDraftDeckService } from "./draft-decks.js";
import { TournamentDuelError } from "./tournament-duels.js";

export type CreateTournamentFromDraftInput = {
  draftId: number;
  format: TournamentFormat;
  createdByUserId: string;
  /** Games per pairing; default 3. */
  bestOf?: 1 | 3;
};

export type CreateTournamentFromDraftResult = {
  tournamentId: number;
  tournamentName: string;
  webSlug: string | undefined;
};

function assertFormat(format: string): asserts format is TournamentFormat {
  if (format !== "round_robin" && format !== "single_elim") {
    throw new Error("Unsupported tournament format");
  }
}

export function createDraftTournamentService(db: Database.Database) {
  return {
    createTournamentFromDraft(
      input: CreateTournamentFromDraftInput,
    ): CreateTournamentFromDraftResult {
      assertFormat(input.format);
      const bestOf = input.bestOf ?? 3;
      if (bestOf !== 1 && bestOf !== 3) throw new TournamentDuelError("Best of must be 1 or 3", 400);

      const draft = db
        .prepare(
          "select id, guild_id, channel_id, name, status, created_by_user_id, tournament_id, config_json from drafts where id = ?",
        )
        .get(input.draftId) as
        | {
            id: number;
            guild_id: string;
            channel_id: string;
            name: string;
            status: string;
            created_by_user_id: string;
            tournament_id: number | null;
            config_json: string;
          }
        | undefined;

      if (!draft) throw new Error("Draft not found");
      if (draft.created_by_user_id !== input.createdByUserId) {
        throw new Error("Only the draft creator can create a tournament from this draft");
      }
      if (draft.status !== "completed") {
        throw new Error("Draft must be completed before creating a tournament");
      }
      if (draft.tournament_id !== null) {
        const existing = db
          .prepare("select id, web_slug, name from tournaments where id = ?")
          .get(draft.tournament_id) as
          | { id: number; web_slug: string | null; name: string }
          | undefined;
        if (existing) {
          return {
            tournamentId: existing.id,
            tournamentName: existing.name,
            webSlug: existing.web_slug ?? undefined,
          };
        }
      }

      const randomizeSeats = (JSON.parse(draft.config_json) as DraftConfig).randomizeSeats === true;

      const result = db.transaction(() => {
        const insertResult = db
          .prepare(
            `insert into tournaments (guild_id, name, format, status, created_by_user_id, web_slug, best_of)
             values (?, ?, ?, 'pending', ?, ?, ?)`,
          )
          .run(draft.guild_id, draft.name, input.format, input.createdByUserId, generateWebSlug(), bestOf);

        const tournamentId = Number(insertResult.lastInsertRowid);

        const players = db
          .prepare(
            randomizeSeats
              ? "select player_id from draft_players where draft_id = ? order by seat_index asc, joined_at asc, rowid asc"
              : "select player_id from draft_players where draft_id = ? order by joined_at asc, rowid asc",
          )
          .all(draft.id) as Array<{ player_id: number }>;

        if (randomizeSeats) {
          const joinStmt = db.prepare(
            "insert into tournament_participants (tournament_id, player_id, joined_at) values (?, ?, datetime(?, ? || ' seconds'))",
          );
          // Seeding sorts by joined_at, so give seats distinct timestamps before now.
          const joinedAt = new Date().toISOString();
          for (const [index, { player_id }] of players.entries()) {
            joinStmt.run(tournamentId, player_id, joinedAt, index - players.length);
          }
        } else {
          const joinStmt = db.prepare(
            "insert into tournament_participants (tournament_id, player_id) values (?, ?)",
          );
          for (const { player_id } of players) {
            joinStmt.run(tournamentId, player_id);
          }
        }

        db.prepare("update drafts set tournament_id = ? where id = ?").run(tournamentId, draft.id);

        // Every human player's drafted deck becomes their entry's deck, so Start duel works at once.
        // A draft that finished before decks were saved automatically gets them here.
        createDraftDeckService(db).saveForDraft(draft.id);

        const tournament = db
          .prepare("select id, name, web_slug from tournaments where id = ?")
          .get(tournamentId) as { id: number; name: string; web_slug: string | null };

        return {
          tournamentId: tournament.id,
          tournamentName: tournament.name,
          webSlug: tournament.web_slug ?? undefined,
        };
      })();

      return result;
    },
  };
}

export type DraftTournamentService = ReturnType<typeof createDraftTournamentService>;
