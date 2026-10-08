import Database from "better-sqlite3";
import { writeFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { migrate } from "../../src/db/schema.js";
import { findDraftReadAccess } from "../../src/services/draft-access.js";
import { findDraftListPage, findTournamentListPage, findDraftListStatusCounts, findTournamentListStatusCounts } from "../../src/services/paged-lists.js";
import { createOpenNowService } from "../../src/services/open-now.js";

it("uses lookup indexes for the actual list, draft access and open-now queries", () => {
  const db = new Database(":memory:");
  const plans: { label: string; sql: string; details: string[] }[] = [];
  let label = "";
  try {
    migrate(db);
    db.exec("insert into users(id,username,display_name) values(101,'viewer','Viewer'); insert into players(id,guild_id,user_id,display_name) values(1,'g',101,'Viewer'); insert into drafts(guild_id,channel_id,name,status,created_by_user_id,web_slug) values('g','c','Draft','pending',101,'draft'); insert into draft_players(draft_id,player_id) values(1,1); insert into tournaments(guild_id,name,format,status,created_by_user_id,web_slug) values('g','Cup','round_robin','pending',101,'cup')");
    const prepare = db.prepare.bind(db);
    const spy = vi.spyOn(db, "prepare").mockImplementation((sql: string) => {
      const statement = prepare(sql);
      if (/from (drafts|tournaments)\b/i.test(sql)) {
        for (const method of ["all", "get"] as const) {
          const execute = statement[method].bind(statement);
          vi.spyOn(statement, method).mockImplementation((...bindings: any[]) => {
            const details = (prepare(`explain query plan ${sql}`).all(...bindings) as {detail:string}[]).map(r => r.detail);
            plans.push({ label, sql, details });
            return execute(...bindings);
          });
        }
      }
      return statement;
    });
    label = "draft list"; findDraftListPage(db,"g",101);
    label = "tournament list"; findTournamentListPage(db,"g",101);
    label = "draft counts"; findDraftListStatusCounts(db,"g",101);
    label = "tournament counts"; findTournamentListStatusCounts(db,"g");
    label = "draft access"; findDraftReadAccess(db,"draft","g",101);
    label = "open now"; createOpenNowService(db).forPlayer("g",1);
    spy.mockRestore();
    const details = (name:string) => plans.filter(p=>p.label===name).flatMap(p=>p.details).join("\n");
    expect(details("draft list")).toContain("draft_players_player_idx");
    expect(details("draft list")).toMatch(/players.*\(guild_id=\? AND user_id=\?\)/);
    expect(details("tournament list")).toContain("tournaments_guild_status_created_idx");
    expect(details("draft counts")).toContain("draft_players_player_idx");
    expect(details("draft counts")).toMatch(/players.*\(guild_id=\? AND user_id=\?\)/);
    expect(details("draft counts")).toContain("drafts_guild_status_created_idx");
    expect(details("tournament counts")).toContain("tournaments_guild_status_created_idx");
    expect(details("draft access")).toContain("drafts_web_slug_unique");
    expect(details("draft access")).toMatch(/players.*\(guild_id=\? AND user_id=\?\)/);
    expect(details("open now")).toContain("drafts_guild_status_created_idx");
    expect(details("open now")).toContain("tournaments_guild_status_created_idx");
    // Optional local evidence export, independent of the test's assertions.
    if (process.env.ACCESS_QUERY_PLAN_REPORT) writeFileSync(process.env.ACCESS_QUERY_PLAN_REPORT, JSON.stringify(plans,null,2)+"\n");
  } finally { vi.restoreAllMocks(); db.close(); }
});
