import { afterEach, describe, expect, it } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import { openDatabase } from "@yugidraft/shared/db";

const root = resolve(import.meta.dirname, "../..");
const dirs: string[] = [];
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "clerk-deploy-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));

describe("production activity guard with the application schema", () => {
  it("ignores stale duels even with a funded clock but protects recent player actions", () => {
    const path = join(fixture(), "prod.sqlite");
    const db = openDatabase(path);
    try {
      db.prepare("INSERT INTO users (id, username, display_name) VALUES (1, 'owner', 'Owner')").run();
      db.prepare("INSERT INTO players (id, guild_id, user_id, display_name) VALUES (1, 'community', 1, 'Owner')").run();
      db.prepare("INSERT INTO duels (guild_id, web_slug, name, organizer_player_id, mode, status, last_activity_at) VALUES ('community', 'idle-duel', 'Idle', 1, 'normal', 'active', datetime('now', '-2 hours'))").run();
      const guard = () => spawnSync("python3", ["-B", join(root, "scripts/deployment/check-prod-activity.py"), path, "--live-only"], { encoding: "utf8" });
      expect(guard().status).toBe(0);
      expect(db.prepare("select status from duels").get()).toEqual({ status: "active" });
      const clock = { turn: 1, activeSeat: 0, startedAt: Date.now() - 11 * 60_000, remainingMs: [30 * 60_000, 30 * 60_000] };
      db.prepare("update duels set clock_json = ?, last_activity_at = datetime('now', '-11 minutes')").run(JSON.stringify(clock));
      expect(guard().status).toBe(0);
      expect(db.prepare("select status, clock_json from duels").get()).toEqual({ status: "active", clock_json: JSON.stringify(clock) });
      db.prepare("update duels set last_activity_at = datetime('now', '-9 minutes')").run();
      expect(guard().status).toBe(1);
    } finally { db.close(); }
  });

  it("accepts idle data and refuses active duels, RPS and dice openings", () => {
    const path = join(fixture(), "prod.sqlite");
    const db = openDatabase(path);
    try {
      db.prepare("INSERT INTO users (id, username, display_name) VALUES (1, 'owner', 'Owner')").run();
      db.prepare("INSERT INTO players (id, guild_id, user_id, display_name) VALUES (1, 'community', 1, 'Owner')").run();
      db.prepare("INSERT INTO duels (guild_id, web_slug, name, organizer_player_id, mode, status) VALUES ('community', 'test-duel', 'Test duel', 1, 'standard', 'lobby')").run();
      const guard = () => spawnSync("python3", ["-B", join(root, "scripts/deployment/check-prod-activity.py"), path], { encoding: "utf8" });
      expect(guard().status).toBe(0);
      for (const [status, opening] of [["active", null], ["lobby", '{"phase":"rps"}'], ["lobby", '{"phase":"dice"}']] as const) {
        db.prepare("UPDATE duels SET status = ?, opening_json = ?").run(status, opening);
        const result = guard();
        expect(result.status, result.stderr).toBe(1);
        expect(result.stdout).toContain("duels=1");
      }
    } finally { db.close(); }
  });
});

describe("anonymous auth health checks", () => {
  function run(status: string, body: string, sessionStatus = "200") {
    const dir = fixture();
    const bin = join(dir, "bin");
    mkdirSync(bin);
    // No sockets: these executables model HTTP responses and healthy container state.
    writeFileSync(join(bin, "curl"), `#!/bin/sh
url=""
output=""
format=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o) output=$2; shift ;;
    -w) format=$2; shift ;;
    http*) url=$1 ;;
  esac
  shift
done
case "$url" in
  */sign-in) code="$SIGNIN_STATUS"; body=sign-in ;;
  */api/auth/session) code="$SESSION_STATUS"; body="$SESSION_BODY" ;;
  */socket.io/*) code=200; body='0{"sid":"offline"}' ;;
  *smoke*) code=308; body="" ;;
  *) code=200; body="" ;;
esac
if [ -n "$output" ]; then printf '%s' "$body" > "$output"; fi
if [ -n "$format" ]; then
  case "$format" in
    *redirect_url*) printf '308 https://app.example.com/smoke?x=1' ;;
    *) printf '%s' "$code" ;;
  esac
elif [ -z "$output" ]; then printf '%s' "$body"; fi
`);
    writeFileSync(join(bin, "docker"), "#!/bin/sh\ncase \"$*\" in *Health*) echo healthy ;; *) echo 'running 0' ;; esac\n");
    chmodSync(join(bin, "curl"), 0o755);
    chmodSync(join(bin, "docker"), 0o755);
    const script = join(root, "scripts/smoke-test-site.sh");
    const args = ["app.example.com"];
    return spawnSync("bash", [script, ...args], {
      encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, SIGNIN_STATUS: status, SESSION_STATUS: sessionStatus, SESSION_BODY: body },
    });
  }
  it("accepts only a 200 sign-in page and a 200 null session", () => {
    expect(run("200", "null").status).toBe(0);
    expect(run("302", "null").status).toBe(1);
    expect(run("200", '{"user":{"id":"1"}}').status).toBe(1);
    expect(run("200", "{broken-json").status).toBe(1);
    expect(run("200", "null", "503").status).toBe(1);
  });
});
