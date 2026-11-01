// Remote Duels screen stack. Same shape as remote-video.mjs, plus the vision data root and the STT socket.
// Focused media stack: shared DB + actual ws + Next dev. No engine, worker or external auth.
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { resolve } from "node:path";
import Database from "better-sqlite3";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../../", import.meta.url));
const directory = resolve(root, "packages/e2e/.stack-remote-ui");
const webPort=Number(process.env.E2E_WEB_PORT ?? 3310), wsPort=Number(process.env.E2E_WS_PORT ?? 3312), internalPort=Number(process.env.E2E_WS_INTERNAL_PORT ?? 4312);
for (const port of [webPort, wsPort, internalPort]) await new Promise((done, fail) => {
  const probe = createServer(); probe.once("error", fail);
  probe.listen(port, () => probe.close(done));
});
mkdirSync(directory, { recursive: true });
process.env.E2E_WEB_PORT = String(webPort);
const { seedDatabase } = await import("./seed.mjs");
const databasePath = resolve(directory, "ui.sqlite");
// Small owned catalog: no running engine, network card API or developer data required.
const engineDirectory=resolve(directory,"duel-engine");
mkdirSync(resolve(engineDirectory,"card-scripts"),{recursive:true});
rmSync(resolve(engineDirectory,"cards.cdb"),{force:true});
const engine=new Database(resolve(engineDirectory,"cards.cdb"));
engine.exec("create table datas(id integer primary key,ot integer,alias integer,setcode integer,type integer,atk integer,def integer,level integer,race integer,attribute integer); create table texts(id integer primary key,name text,desc text)");
const cards=[
  [70825459,"Trap Tracks",4,'Target 1 monster you control; destroy it, and if you do, Set 1 Normal Trap directly from your Deck, except "Trap Tracks".'],
  [53582587,"Torrential Tribute",4,"When a monster(s) is Summoned: Destroy all monsters on the field."],
  [5318639,"Mystical Space Typhoon",0x10002,"Target 1 Spell/Trap on the field; destroy that target."],
  [73628505,"Terraforming",2,"Add 1 Field Spell from your Deck to your hand."],
  [47355498,"Necrovalley",0x80002,"Cards in the GY cannot be banished."],
  ...Array.from({length:35},(_,i)=>[900000001+i,"Origin fixture "+(i+1),0x11,""]),
];
for(const [id,name,type,text] of cards) {
  engine.prepare("insert into datas values(?,3,0,0,?,1000,1000,4,2,1)").run(id,type);
  engine.prepare("insert into texts values(?,?,?)").run(id,name,text);
  writeFileSync(resolve(engineDirectory,"card-scripts","c"+id+".lua"),"");
}
engine.close(); writeFileSync(resolve(engineDirectory,"strings.conf"),"");
await seedDatabase({ databasePath, savedDecks:[{name:"Remote origin fixture",mode:"normal",deck:{main:cards.map(c=>c[0]),extra:[],side:[]}}] });
const appDb=new Database(databasePath);
for(const [id,name,type,text] of cards) appDb.prepare("insert into card_catalog(ygoprodeck_id,name,type,frame_type,effect_text,image_url,image_url_small,card_sets_json,cached_at) values(?,?,?,?,?,'','','[]',datetime('now'))")
  .run(id,name,type===4 ? "Trap Card" : type===0x11 ? "Normal Monster" : "Spell Card",type===4 ? "trap" : type===0x11 ? "normal" : "spell",text);
appDb.close();
const secret = process.env.E2E_AUTH_SECRET;
if (!secret || secret.length < 32) throw new Error("Use playwright.remote-ui.config.ts for throwaway auth");
const env = {
  ...process.env, DATABASE_PATH: databasePath, REMOTE_DUELS: "1",
  DUEL_DATA_DIR: engineDirectory,
  DISCORD_GUILD_ID: "900000000000000001", DOTENV_CONFIG_PATH: resolve(directory, "none.env"),
  WS_INTERNAL_SECRET: secret, WS_PORT: String(wsPort), WS_INTERNAL_PORT: String(internalPort),
  WS_INTERNAL_URL: `http://127.0.0.1:${internalPort}`, WEB_URL: `http://localhost:${webPort}`, NEXT_PUBLIC_WS_URL: `http://localhost:${wsPort}`,
  E2E_AUTH: "1", CLERK_SECRET_KEY: "", NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "",
  VISION_DATA_DIR: process.env.VISION_DATA_DIR ?? "", NEXT_PUBLIC_REMOTE_STT_URL: process.env.NEXT_PUBLIC_REMOTE_STT_URL ?? "ws://localhost:4020/ws",
  LIVEKIT_URL: process.env.LIVEKIT_URL ?? "ws://127.0.0.1:7880",
  LIVEKIT_API_KEY: process.env.LIVEKIT_API_KEY ?? "devkey", LIVEKIT_API_SECRET: process.env.LIVEKIT_API_SECRET ?? "secret",
};
const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return; stopping = true;
  for (const child of children) if (child.exitCode === null) child.kill("SIGTERM");
  const timer = setTimeout(() => { for (const child of children) if (child.exitCode === null) child.kill("SIGKILL"); }, 10_000);
  Promise.all(children.map(child => child.exitCode !== null ? Promise.resolve() : new Promise(done => child.once("exit", done))))
    .then(() => { clearTimeout(timer); process.exit(code); });
}
process.once("SIGTERM", () => stop()); process.once("SIGINT", () => stop());
function run(args, cwd) {
  const child = spawn(process.execPath, args, { cwd, env, stdio: "inherit" }); children.push(child);
  child.once("error", () => stop(1)); child.once("exit", () => { if (!stopping) stop(1); });
}
run([resolve(root, "node_modules/tsx/dist/cli.mjs"), "src/server.ts"], resolve(root, "packages/ws"));
const next = resolve(root, "node_modules/next/dist/bin/next");
if (process.env.E2E_PROD === "1") {
  // Production build: what players get (no dev-only routes, request-time gates, COOP/COEP headers). Slower to start.
  await new Promise((done, fail) => {
    const build = spawn(process.execPath, [next, "build", "--webpack"], { cwd: resolve(root, "packages/web"), env: { ...env, NODE_ENV: "production" }, stdio: "inherit" });
    build.once("exit", code => code === 0 ? done() : fail(new Error(`next build failed (${code})`)));
  });
  run([next, "start", "-p", String(webPort)], resolve(root, "packages/web"));
} else {
  // Direct Next CLI avoids leaving npm's grandchildren behind when Playwright terminates the stack.
  run([next, "dev", "--webpack", "-p", String(webPort)], resolve(root, "packages/web"));
}
