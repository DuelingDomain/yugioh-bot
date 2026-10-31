// @vitest-environment jsdom
import React, { createRef } from "react";
import Database from "better-sqlite3";
import { webcrypto } from "node:crypto";
import { existsSync } from "node:fs";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { beforeAll, afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyCardQuery, type CardQueryResult } from "@yugidraft/shared/duels";
import { migrate } from "../../shared/src/db/schema";
import { importCardEffectArtifact } from "../../shared/src/cards/effects/artifact";
import { loadCardDatabase } from "../../duel-server/src/cards";
import { createCanonicalEffectResolver, createCardEffectIndex } from "../../duel-server/src/card-effects";
import { createDuelHost, type DuelHost } from "../../duel-server/src/host";
import { seedIdentity } from "../../duel-server/tests/helpers/identity";
import { signedHeaders } from "../../duel-server/tests/helpers/signed-request";
import { CardBrowser } from "../src/components/decks/card-browser";
import * as bridgesApi from "../src/lib/bridges-api";

const api=vi.hoisted(()=>({query:vi.fn()}));
vi.mock("../src/components/decks/api",async original=>({...await original<typeof import("../src/components/decks/api")>(),queryDeckCards:api.query}));
// Vite's DOM transform turns this server asset URL into an HTTP URL. Keep the real policy reader with its file path.
vi.mock("../../duel-server/src/card-block-list",async original=>{
  const policy=await original<typeof import("../../duel-server/src/card-block-list")>();
  const {resolve,dirname}=await import("node:path"),{fileURLToPath}=await import("node:url");
  const path=resolve(dirname(fileURLToPath(import.meta.url)),"../../duel-server/card-block-list.json");
  return {...policy,loadCardBlockList:(_path:unknown,data?:string)=>policy.loadCardBlockList(path,data)};
});
const directory=process.env.DUEL_DATA_DIR;
describe.skipIf(!directory || !existsSync(`${directory}/cards.cdb`))("Name + text UI through a signed host and real card artifact",()=>{
  let db:Database.Database, cards:ReturnType<typeof loadCardDatabase>, host:DuelHost, playerId:number;
  let last:CardQueryResult;
  beforeAll(()=>{
    db=new Database(":memory:");migrate(db);cards=loadCardDatabase(directory!);
    importCardEffectArtifact(db,{canonicalize:createCanonicalEffectResolver(cards)});createCardEffectIndex(db,cards);
    playerId=seedIdentity(db,{guildId:"ui-effect-integration"}).playerId;
    host=createDuelHost({db,dataDirectory:directory!,secret:"ui-effect-test",searchCards:()=>[],pollIntervalMs:60_000});
  },20_000);
  afterAll(async()=>{await host?.close();db?.close();cards?.close();});
  beforeEach(()=>{
    vi.stubGlobal("crypto",webcrypto);
    vi.stubEnv("EFFECT_SEARCH","1");vi.stubEnv("ANTHROPIC_API_KEY","");
    api.query.mockImplementation(async(cardQuery:object)=>{
      const body=JSON.stringify({op:"card-query",guildId:"ui-effect-integration",playerId,cardQuery});
      const response=await host.handle(new Request("http://local/internal/duel",{method:"POST",body,
        headers:await signedHeaders(body,"ui-effect-test","http://local/internal/duel","duel-host")}));
      expect(response.status).toBe(200);last=await response.json();return last;
    });
  });
  afterEach(()=>{cleanup();vi.unstubAllEnvs();vi.unstubAllGlobals();});
  it.each([
    ["recruiters","Mother Grizzly"], ["water recruiter","Mother Grizzly"],
    ["recruiters 1500 atk or less","Mystic Tomato"], ["staples","Ash Blossom & Joyous Spring"],
    ["Blue-Eyes hand traps","Infinite Impermanence"], ["Blue-Eyes hand traps","Droll & Lock Bird"], ["Branded removal","Branded Beast"],
  ])("shows real effect hits with zero name hits: %s",async(text,name)=>{
    render(<CardBrowser query={{...emptyCardQuery(),text}} onQueryChange={vi.fn()} archetypes={[]} limits={null}
      view="grid" onViewChange={vi.fn()} deckCount={()=>0} inspectCode={null} onInspect={vi.fn()} onHover={vi.fn()}
      onAdd={vi.fn()} onCatalog={vi.fn()} onRemoveDrop={vi.fn()} searchRef={createRef<HTMLInputElement>()}/>);
    await waitFor(()=>expect(screen.getByRole("button",{name:label=>label===name||label.startsWith(`${name},`)})).toBeVisible());
    expect(last.total).toBe(0);expect(last.effectTotal).toBeGreaterThan(0);
    expect(screen.getByText(`${last.effectTotal} cards`)).toBeVisible();
    expect(screen.queryByRole("button",{name:"Morphtronic Staplen"})).not.toBeInTheDocument();
    if(text==="staples")expect(screen.getByText("Played in 100% of TCG decks")).toBeVisible();
    if(text.startsWith("Blue-Eyes")){
      expect(screen.getByRole("button",{name:"Remove reading For Blue-Eyes decks"})).toBeVisible();
      expect(screen.getByRole("region",{name:"How it plays: Blue-Eyes"})).toBeVisible();
      expect(screen.queryByText("How to beat Blue-Eyes")).not.toBeInTheDocument();
    }
  });
  it.each([
    ["Temple of the Kings synergy", "Ryu Senshi"],
    ["Monarch synergy", "Lair of Darkness"],
    ["synergy with Temple of the Kings and Blue-Eyes", "Lightstorm Dragon"],
  ])("shows outside synergy partners and retains the bridges offer: %s", async (text, name) => {
    const names = vi.spyOn(bridgesApi, "fetchBridgeArchetypes").mockResolvedValue(["Temple of the Kings", "Blue-Eyes", "Monarch"]);
    const onTab = vi.fn();
    try {
      render(<CardBrowser query={{ ...emptyCardQuery(), text }} onQueryChange={vi.fn()} archetypes={[]} limits={null}
        view="grid" onViewChange={vi.fn()} deckCount={() => 0} inspectCode={null} onInspect={vi.fn()} onHover={vi.fn()}
        onAdd={vi.fn()} onCatalog={vi.fn()} onRemoveDrop={vi.fn()} searchRef={createRef<HTMLInputElement>()}
        suggest={{ deck: { main: [], extra: [], side: [] } }}
        columns={{ tabs: ["cards", "bridges"], tab: "cards", onTab, bar: false, tabIdPrefix: "synergy-test", bridgesDot: false,
          onDeepFinished: vi.fn(), onSuggestDisabled: vi.fn(), onBridgesDisabled: vi.fn() }} />);
      await waitFor(() => expect(screen.getByRole("button", { name: label => label === name || label.startsWith(`${name},`) })).toBeVisible(), { timeout: 5000 });
      expect(last.effectTotal).toBeGreaterThan(0);
      if (text.includes("and Blue-Eyes")) {
        const offer = screen.getByRole("button", { name: "See bridges for Temple of the Kings + Blue-Eyes" });
        expect(offer).toBeVisible();
        fireEvent.click(offer);
        expect(onTab).toHaveBeenCalledWith("bridges");
      }
    } finally { names.mockRestore(); }
  });
});
