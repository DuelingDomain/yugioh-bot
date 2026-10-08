import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../../src/db/schema.js";
import * as services from "../../src/services/index.js";
import { seedIdentity } from "../helpers/identity.js";
import { userHistory } from "../../src/services/user-history.js";

let db: Database.Database;
let host: ReturnType<typeof seedIdentity>;
beforeEach(() => { db = new Database(":memory:"); migrate(db); host = seedIdentity(db, { guildId: "g" }); });
afterEach(() => db.close());

it("defaults shared creation to private, maps open visibility and never maps the invite code", () => {
  const tournaments = services.createTournamentService(db);
  expect(tournaments.create("g", "Private", "round_robin", host.userId).visibility).toBe("private");
  const open = tournaments.create("g", "Open", "round_robin", host.userId, { visibility: "open" });
  expect(tournaments.findById(open.id).visibility).toBe("open");
  expect(open).not.toHaveProperty("inviteCode");
});

it("redeems user grants once, rejects wrong codes, and preserves grants after rotation", () => {
  const tournament = services.createTournamentService(db).create("g", "Cup", "round_robin", host.userId);
  const guest = seedIdentity(db, { guildId: "g", name: "Guest" });
  const stranger = seedIdentity(db, { guildId: "g", name: "Stranger" });
  const privacy = services.createTournamentVisibilityService(db);
  expect(() => privacy.invite(tournament.webSlug!, "g", guest.userId)).toThrow("Tournament not found");
  const code = privacy.invite(tournament.webSlug!, "g", host.userId);
  expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(privacy.invite(tournament.webSlug!, "g", host.userId)).toBe(code);
  expect(() => privacy.admit(tournament.webSlug!, "g", guest.userId, "wrong")).toThrow("Tournament not found");
  privacy.admit(tournament.webSlug!, "g", guest.userId, code);
  privacy.admit(tournament.webSlug!, "g", guest.userId, code);
  expect(services.findTournamentReadAccess(db, tournament.id, "g", guest.userId)).toMatchObject({ canRead: true, canJoin: true });
  expect(userHistory(db, guest.userId)).toEqual({});
  const current = privacy.resetInvite(tournament.webSlug!, "g", host.userId);
  expect(current).not.toBe(code);
  expect(() => privacy.admit(tournament.webSlug!, "g", stranger.userId, code)).toThrow("Tournament not found");
  expect(services.findTournamentReadAccess(db, tournament.id, "g", guest.userId)?.canRead).toBe(true);
  expect(db.prepare("select user_id from tournament_invite_grants").all()).toEqual([{ user_id: guest.userId }]);
  privacy.admit(tournament.webSlug!, "g", stranger.userId, current);
});

it("restricts visibility to the pending creator before validating its value", () => {
  const tournament = services.createTournamentService(db).create("g", "Cup", "round_robin", host.userId);
  const privacy = services.createTournamentVisibilityService(db);
  expect(() => privacy.setVisibility(tournament.webSlug!, "g", 999, "invalid")).toThrow("Tournament not found");
  expect(() => privacy.setVisibility(tournament.webSlug!, "g", host.userId, "invalid")).toThrow("visibility must be open or private");
  expect(privacy.setVisibility(tournament.webSlug!, "g", host.userId, "open")).toBe("open");
  db.exec("update tournaments set status='active'");
  expect(() => privacy.setVisibility(tournament.webSlug!, "g", host.userId, "private")).toThrow("Tournament must be pending");
});

describe("tournament access matrix", () => {
  for (const visibility of ["open", "private"] as const) {
    for (const status of ["pending", "active", "completed"] as const) {
      for (const role of ["creator", "participant", "grant", "stranger"] as const) {
        it(`${visibility} ${status}: ${role}`, () => {
          const tournament = services.createTournamentService(db).create("g", "Cup", "round_robin", host.userId, { visibility });
          const viewer = role === "creator" ? host : seedIdentity(db, { guildId: "g", name: role });
          if (role === "participant") db.prepare("insert into tournament_participants(tournament_id,player_id) values(?,?)").run(tournament.id, viewer.playerId);
          if (role === "grant") {
            const privacy = services.createTournamentVisibilityService(db);
            privacy.admit(tournament.webSlug!, "g", viewer.userId, privacy.invite(tournament.webSlug!, "g", host.userId));
          }
          db.prepare("update tournaments set status=? where id=?").run(status, tournament.id);
          const expected = {
            id: tournament.id, status, visibility, isParticipant: role === "participant",
            canRead: visibility === "open" || role !== "stranger",
            canJoin: status === "pending" && role !== "participant" && (visibility === "open" || role !== "stranger"),
          };
          expect(services.findTournamentReadAccess(db, tournament.webSlug!, "g", viewer.userId)).toEqual(expected);
          expect(services.findTournamentReadAccess(db, tournament.id, "g", viewer.userId)).toEqual(expected);
          expect(services.findTournamentReadAccess(db, tournament.id, "other", viewer.userId)).toBeNull();
        });
      }
    }
  }
});
