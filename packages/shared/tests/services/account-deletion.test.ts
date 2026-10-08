import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../../src/db/schema.js";
import { createUserService } from "../../src/services/users.js";
import {
  DELETED_PLAYER_NAME,
  deleteUserAccount,
  previewUserDeletion,
} from "../../src/services/account-deletion.js";
import * as services from "../../src/services/index.js";

let db: Database.Database;

const EMAIL = "target@example.com";
const NAME = "Target Name";

function exec(sql: string) { db.exec(sql); }

/** Every table, every row, for exact before/after comparisons. */
function dump(): Record<string, unknown[]> {
  const tables = db.prepare("select name from sqlite_master where type='table' and name not like 'sqlite_%' order by name").all() as { name: string }[];
  return Object.fromEntries(tables.map(({ name }) => [name, db.prepare(`select * from "${name}" order by rowid`).all()]));
}

beforeEach(() => {
  db = new Database(":memory:");
  migrate(db);
  db.pragma("foreign_keys = on");
  exec(`
    insert into users(id,clerk_user_id,email,email_verified,username,display_name,discord_user_id,synced_at)
      values (1,'user_target','${EMAIL}',1,'target','${NAME}','111','2026-10-06T00:00:00.000Z'),
             (2,'user_other','other@example.com',1,'other','Other Name','222','2026-10-06T00:00:00.000Z');
    insert into players(id,guild_id,user_id,discord_user_id,display_name)
      values (1,'g',1,'111','${NAME}'),(2,'g',2,'222','Other Name');
    insert into card_catalog(ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at)
      values (1,'Card','Effect Monster','effect','','','[]','2026-10-06');
    insert into tournaments(id,guild_id,name,format,status,created_by_user_id) values (1,'g','Cup','round_robin','active',2);
    insert into saved_decks(id,guild_id,owner_user_id,name,mode,deck_json) values (1,'g',1,'Private deck','normal','{"main":[1]}'),(2,'g',2,'Other deck','normal','{"main":[1]}');
    insert into tournament_participants(tournament_id,player_id,saved_deck_id,deck_json) values (1,1,1,'{"main":[1]}'),(1,2,2,'{"main":[1]}');
    insert into matches(id,guild_id,player_one_id,player_two_id,winner_id,reporter_id,approver_id,status,source,tournament_id)
      values (1,'g',1,2,1,1,2,'confirmed','tournament',1);
    insert into tournament_matches(id,tournament_id,match_id,player_one_id,player_two_id,round_number,status,metadata_json)
      values (1,1,1,1,2,1,'complete','{"winnerId":1}');
    insert into seasons(id,guild_id,number,status,created_by_user_id) values (1,'g',1,'active',1);
    insert into player_ratings(guild_id,player_id) values ('g',1),('g',2);
    insert into point_awards(guild_id,season_id,player_id,kind,match_id,points) values ('g',1,1,'match_win',1,10);
    insert into season_standings(guild_id,season_id,player_id,wins) values ('g',1,1,1),('g',1,2,0);
    insert into player_achievements(guild_id,player_id,achievement_key) values ('g',1,'first');
    insert into cubes(id,guild_id,name,created_by_user_id) values (1,'g','Target cube',1);
    insert into drafts(id,guild_id,channel_id,name,status,created_by_user_id) values (1,'g','c','Draft night','complete',1);
    insert into draft_players(draft_id,player_id) values (1,1),(1,2);
    insert into draft_cards(id,draft_id,wave_number,catalog_card_id,picked_by_player_id) values (1,1,1,1,1);
    insert into draft_picks(draft_id,player_id,draft_card_id,wave_number,pick_step,picked_at) values (1,1,1,1,1,'2026-10-06');
    insert into draft_passes(draft_id,player_id,wave_number,pick_step,passed_at) values (1,2,1,2,'2026-10-06');
    insert into duel_series(id,guild_id,player0_id,player1_id,winner_player_id,created_by_player_id,mode,settings_json)
      values (1,'g',1,2,1,1,'normal','{}');
    insert into duels(id,guild_id,web_slug,name,organizer_player_id,winner_player_id,mode,status,series_id)
      values (1,'g','d1','${NAME} vs Other Name',1,1,'normal','completed',1),
             (2,'g','d2','Other Name vs ${NAME}',2,1,'normal','completed',null),
             (3,'g','d3','Friday finals',1,null,'normal','completed',null),
             (4,'g','d4','${NAME} vs Someone',2,2,'normal','completed',null);
    insert into duel_seats(duel_id,seat,player_id) values (1,0,1),(1,1,2),(2,0,2),(2,1,1),(3,0,1),(4,0,2);
    insert into duel_invite_grants(duel_id,player_id) values (1,1);
    insert into bug_reports(id,guild_id,player_id,created_at,path,description,context_json)
      values (1,'g',1,'2026-10-06','/duel/d1','It broke for ${NAME}','{"userAgent":"Mozilla/5.0 test","seat":0,"turn":3}'),
             (2,'g',2,'2026-10-06','/drafts','Other report','{"userAgent":"Other UA"}');
    insert into waitlist_signups(email,created_at,source,user_agent)
      values ('${EMAIL}','2026-10-01','form','Mozilla/5.0 test'),('other@example.com','2026-10-01','form','Other UA');
  `);
});
afterEach(() => db.close());

describe("deleteUserAccount", () => {
  it("removes a user holding only invite grants and cascades those grants", () => {
    exec(`insert into users(id,clerk_user_id,username,display_name) values(3,'user_three','three','Three');
      insert into draft_invite_grants(draft_id,user_id) values(1,2),(1,3);`);
    expect(previewUserDeletion(db, 3)).toMatchObject({ mode: "removed" });
    expect(deleteUserAccount(db, 3)).toMatchObject({ mode: "removed", counts: { users: 1 } });
    expect(db.prepare("select id from users where id=3").get()).toBeUndefined();
    expect(db.prepare("select draft_id,user_id from draft_invite_grants").all()).toEqual([{ draft_id: 1, user_id: 2 }]);
    expect(db.prepare("select id from drafts").get()).toEqual({ id: 1 });
    expect(db.pragma("foreign_key_check")).toEqual([]);
  });
  it("is exported from the services index", () => {
    expect(services.deleteUserAccount).toBe(deleteUserAccount);
  });

  it("removes a user who has no history, with their saved decks, players and waitlist row", () => {
    exec(`
      insert into users(id,clerk_user_id,email,email_verified,username,display_name,discord_user_id)
        values (3,'user_three','three@example.com',1,'three','Three','333');
      insert into players(id,guild_id,user_id,discord_user_id,display_name) values (3,'g',3,'333','Three'),(4,'h',3,'333','Three');
      insert into saved_decks(id,guild_id,owner_user_id,name,mode,deck_json) values (3,'g',3,'Deck','normal','{}');
      insert into waitlist_signups(email,created_at,source) values ('three@example.com','2026-10-01','form');
    `);
    const before = dump();
    const summary = deleteUserAccount(db, 3);
    expect(summary.mode).toBe("removed");
    expect(summary.userId).toBe(3);
    expect(summary.counts).toMatchObject({ users: 1, players: 2, saved_decks: 1, waitlist_signups: 1 });
    expect(db.prepare("select count(*) c from users where id=3").get()).toEqual({ c: 0 });
    expect(db.prepare("select count(*) c from players where user_id=3").get()).toEqual({ c: 0 });
    expect(db.prepare("select count(*) c from saved_decks where owner_user_id=3").get()).toEqual({ c: 0 });
    expect(db.prepare("select count(*) c from waitlist_signups where email='three@example.com'").get()).toEqual({ c: 0 });
    // Nothing else changed.
    const after = dump();
    for (const table of Object.keys(before)) {
      if (["users", "players", "saved_decks", "waitlist_signups"].includes(table)) continue;
      expect(after[table], table).toEqual(before[table]);
    }
    expect(db.pragma("foreign_key_check")).toEqual([]);
  });

  it("removes a user whose only data is saved decks instead of leaving an empty ghost row", () => {
    exec(`
      insert into users(id,email,email_verified,username,display_name) values (3,'three@example.com',1,'three','Three');
      insert into saved_decks(id,guild_id,owner_user_id,name,mode,deck_json) values (3,'g',3,'Deck','normal','{}');
    `);
    expect(deleteUserAccount(db, 3).mode).toBe("removed");
    expect(db.prepare("select count(*) c from users where id=3").get()).toEqual({ c: 0 });
  });

  it("anonymises a user with history and keeps every gameplay row on the same player and user IDs", () => {
    const before = dump();
    const summary = deleteUserAccount(db, 1);
    expect(summary.mode).toBe("anonymised");
    expect(db.prepare("select * from users where id=1").get()).toMatchObject({
      id: 1, clerk_user_id: null, email: null, email_verified: 0, discord_user_id: null,
      username: "deleted-1", display_name: DELETED_PLAYER_NAME, synced_at: null,
    });
    expect(db.prepare("select id,user_id,discord_user_id,display_name from players where id=1").get())
      .toEqual({ id: 1, user_id: 1, discord_user_id: null, display_name: DELETED_PLAYER_NAME });

    // Shared history is untouched: same IDs in every table, nothing deleted or repointed.
    const after = dump();
    for (const table of ["matches", "tournament_matches", "draft_players", "draft_cards", "draft_picks", "draft_passes",
      "duel_seats", "duel_series", "duel_invite_grants", "season_standings", "point_awards", "player_ratings",
      "player_achievements", "tournaments", "cubes", "drafts", "seasons", "card_catalog"]) {
      expect(after[table], table).toEqual(before[table]);
    }
    expect(db.prepare("select created_by_user_id from cubes where id=1").get()).toEqual({ created_by_user_id: 1 });
    expect(db.prepare("select created_by_user_id from drafts where id=1").get()).toEqual({ created_by_user_id: 1 });
    expect(db.prepare("select created_by_user_id from seasons where id=1").get()).toEqual({ created_by_user_id: 1 });
    // The other player is untouched.
    expect(after.users[1]).toEqual(before.users[1]);
    expect(db.prepare("select * from players where id=2").get()).toEqual(before.players[1]);
    expect(db.pragma("foreign_key_check")).toEqual([]);
  });

  it("returns a summary with counts and no personal data", () => {
    const text = JSON.stringify(deleteUserAccount(db, 1));
    for (const secret of [EMAIL, NAME, "user_target", "111", "Mozilla"]) expect(text).not.toContain(secret);
  });

  it("deletes saved decks, nulls tournament deck links and keeps the registered deck copy", () => {
    const summary = deleteUserAccount(db, 1);
    expect(summary.counts.saved_decks).toBe(1);
    expect(db.prepare("select id from saved_decks order by id").all()).toEqual([{ id: 2 }]);
    expect(db.prepare("select player_id,saved_deck_id,deck_json from tournament_participants order by player_id").all()).toEqual([
      { player_id: 1, saved_deck_id: null, deck_json: '{"main":[1]}' },
      { player_id: 2, saved_deck_id: 2, deck_json: '{"main":[1]}' },
    ]);
  });

  it("deletes only the waitlist rows that match their email, read before it is scrubbed", () => {
    const summary = deleteUserAccount(db, 1);
    expect(summary.counts.waitlist_signups).toBe(1);
    expect(db.prepare("select email from waitlist_signups").all()).toEqual([{ email: "other@example.com" }]);
  });

  it("scrubs copied names: default duel names for their duels, device data in their bug reports", () => {
    const summary = deleteUserAccount(db, 1);
    expect(db.prepare("select id,name from duels order by id").all()).toEqual([
      { id: 1, name: `${DELETED_PLAYER_NAME} vs Other Name` },
      { id: 2, name: `Other Name vs ${DELETED_PLAYER_NAME}` },
      { id: 3, name: "Friday finals" },
      // Not their duel (they hold no seat, are not the organizer): left alone even if the text matches.
      { id: 4, name: `${NAME} vs Someone` },
    ]);
    expect(summary.counts.duel_names).toBe(2);
    expect(summary.counts.bug_report_contexts).toBe(1);
    const mine = db.prepare("select description,context_json from bug_reports where id=1").get() as { description: string; context_json: string };
    expect(JSON.parse(mine.context_json)).toEqual({ seat: 0, turn: 3 });
    expect(mine.description).toBe(`It broke for ${NAME}`); // free text stays
    expect(db.prepare("select context_json from bug_reports where id=2").get()).toEqual({ context_json: '{"userAgent":"Other UA"}' });
  });

  it("is a no-op the second time", () => {
    const first = deleteUserAccount(db, 1);
    const afterFirst = dump();
    const second = deleteUserAccount(db, 1);
    expect(second.mode).toBe("anonymised");
    expect(first.mode).toBe("anonymised");
    expect(Object.values(second.counts).every(count => count === 0)).toBe(true);
    expect(dump()).toEqual(afterFirst);
  });

  it("is a defined no-op for a user that is already removed or never existed", () => {
    exec("insert into users(id,username,display_name) values (3,'three','Three')");
    expect(deleteUserAccount(db, 3).mode).toBe("removed");
    const after = dump();
    const again = deleteUserAccount(db, 3);
    expect(again).toEqual({ userId: 3, mode: "removed", counts: {} });
    expect(deleteUserAccount(db, 999)).toEqual({ userId: 999, mode: "removed", counts: {} });
    expect(dump()).toEqual(after);
  });

  it("rolls everything back when any step fails", () => {
    exec("create trigger boom before delete on waitlist_signups begin select raise(abort, 'boom'); end");
    const before = dump();
    expect(() => deleteUserAccount(db, 1)).toThrow();
    expect(dump()).toEqual(before);
    expect(db.inTransaction).toBe(false);
  });

  it("rolls back a removal too", () => {
    exec(`
      insert into users(id,email,email_verified,username,display_name) values (3,'three@example.com',1,'three','Three');
      insert into players(id,guild_id,user_id,display_name) values (3,'g',3,'Three');
      insert into saved_decks(id,guild_id,owner_user_id,name,mode,deck_json) values (3,'g',3,'Deck','normal','{}');
      insert into waitlist_signups(email,created_at,source) values ('three@example.com','2026-10-01','form');
      create trigger boom before delete on users begin select raise(abort, 'boom'); end;
    `);
    const before = dump();
    expect(() => deleteUserAccount(db, 3)).toThrow();
    expect(dump()).toEqual(before);
  });

  it("lets the same Discord account start a clean user afterwards, never reattaching the old history", () => {
    deleteUserAccount(db, 1);
    const outcome = createUserService(db).resolveClerkProfile({
      clerkUserId: "user_returning", username: "returning", displayName: "Returning", email: EMAIL,
      emailVerified: true, discordUserId: "111", imageUrl: null,
    });
    expect(outcome.conflict).toBeNull();
    expect(outcome.foldedUserId).toBeNull();
    expect(outcome.user.id).not.toBe(1);
    expect(db.prepare("select count(*) c from players where user_id=?").get(outcome.user.id)).toEqual({ c: 0 });
  });
});

describe("previewUserDeletion", () => {
  it("reports the mode and whether Clerk still holds the account, without writing", () => {
    const before = dump();
    expect(previewUserDeletion(db, 1)).toMatchObject({ exists: true, mode: "anonymised", hasClerkUser: true });
    expect(dump()).toEqual(before);
    exec("insert into users(id,clerk_user_id,username,display_name) values (3,'user_three','three','Three')");
    expect(previewUserDeletion(db, 3)).toMatchObject({ exists: true, mode: "removed", hasClerkUser: true });
    expect(previewUserDeletion(db, 999)).toMatchObject({ exists: false, mode: "removed", hasClerkUser: false });
  });

  it("counts a user whose only history is saved decks as removable", () => {
    exec(`insert into users(id,username,display_name) values (3,'three','Three');
          insert into saved_decks(guild_id,owner_user_id,name,mode,deck_json) values ('g',3,'Deck','normal','{}')`);
    expect(previewUserDeletion(db, 3).mode).toBe("removed");
  });
});
