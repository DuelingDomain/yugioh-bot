import Database from "better-sqlite3";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { migrate } from "../../shared/src/db/schema";
import type { AwardEntry } from "../src/components/player/profile-model";
import { ProfileWinnings } from "../src/components/player/profile-winnings";

const state = vi.hoisted(() => ({ db: null as Database.Database | null }));
vi.mock("@/lib/db", () => ({ getDb: () => state.db! }));
vi.mock("@/lib/auth", () => ({ auth: async () => ({ user: { id: "104" } }) }));
vi.mock("@/lib/env", () => ({ env: { discordGuildId: "g" } }));
vi.mock("@/components/player/profile-view", () => ({ ProfileView: ({ profile }: { profile: { recent: AwardEntry[] } }) => <ProfileWinnings recent={profile.recent} /> }));
import PlayerProfilePage from "../app/(app)/player/[id]/page";

beforeEach(() => {
  state.db = new Database(":memory:"); migrate(state.db);
  state.db.exec(`insert into users(id,username,display_name) values(101,'host','Host'),(102,'subject','Subject'),(104,'viewer','Viewer');
    insert into players(id,guild_id,user_id,display_name) values(1,'g',102,'Subject');
    insert into tournaments(id,guild_id,name,format,status,created_by_user_id,web_slug) values(1,'g','Secret Cup','round_robin','completed',101,'secret');
    insert into seasons(id,guild_id,number,status) values(1,'g',1,'active');
    insert into point_awards(guild_id,season_id,player_id,kind,tournament_id,points) values('g',1,1,'placement',1,15);`);
});
afterEach(() => state.db?.close());

it("the profile page redacts awards for strangers and winnings render a clean label without a tournament link", async () => {
  const html = renderToStaticMarkup(await PlayerProfilePage({ params: Promise.resolve({ id: "1" }) }));
  expect(html).not.toContain("Secret Cup");
  expect(html).not.toContain("/tournament/");
  expect(html).toContain("Ranked matches");
  expect(html).toContain("Placing");
});

it("the profile page keeps metadata for an application-user grantee without a player", async () => {
  state.db!.exec("insert into tournament_invite_grants(tournament_id,user_id) values(1,104)");
  const html = renderToStaticMarkup(await PlayerProfilePage({ params: Promise.resolve({ id: "1" }) }));
  expect(html).toContain("Secret Cup");
  expect(html).toContain('href="/tournament/1"');
});
