import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { ExpectedError } from "../observability/index.js";

export interface ReleaseSection { kind: "new" | "improvements" | "cards" | "fixes" | "howto"; items: string[] }
export interface Release {
  id: string; version: string; title: string; major: boolean; publishedAt: string;
  highlights: string[]; sections: ReleaseSection[];
}
export type AdminRelease = Omit<Release, "publishedAt"> & { publishedAt: string | null; status: "draft" | "published" };
export interface ReleaseWrite { version: string; title: string; major: boolean; highlights: string[]; sections: ReleaseSection[] }
export class ReleaseError extends ExpectedError {
  constructor(readonly code: string, status = 400) { super(code, status); }
}
interface Row {
  id: string; version: string; title: string; major: number; published_at: number | null;
  highlights_json: string; sections_json: string;
}
export function releaseFromRow(row: Row): AdminRelease {
  return { id: row.id, version: row.version, title: row.title, major: row.major === 1,
    publishedAt: row.published_at === null ? null : new Date(row.published_at).toISOString(),
    highlights: JSON.parse(row.highlights_json), sections: JSON.parse(row.sections_json),
    status: row.published_at === null ? "draft" : "published" };
}
export function publishedRelease(row: AdminRelease): Release {
  if (row.publishedAt === null) throw new ReleaseError("release_not_published", 409);
  const { status: _status, ...release } = row;
  return { ...release, publishedAt: row.publishedAt };
}
export function validateReleaseWrite(input: unknown): ReleaseWrite {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new ReleaseError("invalid_release");
  const value = input as Record<string, unknown>;
  const text = (v: unknown, max: number): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= max && !/[\u0000-\u0008\u000b-\u001f]/.test(v);
  if (!text(value.version, 40) || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value.version)
    || value.version.split(".").some(part => !Number.isSafeInteger(Number(part)))
    || !text(value.title, 160) || typeof value.major !== "boolean"
    || !Array.isArray(value.highlights) || value.highlights.length > 6 || !value.highlights.every(v => text(v, 500))
    || !Array.isArray(value.sections) || value.sections.length > 10) throw new ReleaseError("invalid_release");
  const kinds = new Set(["new", "improvements", "cards", "fixes", "howto"]);
  const sections = value.sections.map((section: unknown): ReleaseSection => {
    if (!section || typeof section !== "object") throw new ReleaseError("invalid_release");
    const s = section as Record<string, unknown>;
    if (typeof s.kind !== "string" || !kinds.has(s.kind) || !Array.isArray(s.items) || !s.items.length || s.items.length > 30 || !s.items.every(v => text(v, 2000))) throw new ReleaseError("invalid_release");
    return { kind: s.kind as ReleaseSection["kind"], items: s.items.map(v => (v as string).trim()) };
  });
  if (JSON.stringify(value).length > 14000) throw new ReleaseError("invalid_release");
  return { version: value.version, title: value.title.trim(), major: value.major,
    highlights: value.highlights.map(v => (v as string).trim()), sections };
}
function compareVersions(a: string, b: string): number {
  const aa = a.split(".").map(Number), bb = b.split(".").map(Number);
  for (let n = 0; n < 3; n++) if (aa[n] !== bb[n]) return aa[n] > bb[n] ? 1 : -1;
  return 0;
}
export function createReleaseService(db: Database.Database) {
  const find = (id: string): AdminRelease => {
    const row = db.prepare<[string], Row>("select * from releases where id=?").get(id);
    if (!row) throw new ReleaseError("not_found", 404);
    return releaseFromRow(row);
  };
  const unique = (version: string, id: string) => {
    if (db.prepare("select 1 from releases where version=? and id!=?").get(version, id)) throw new ReleaseError("version_exists", 409);
  };
  return {
    get: find,
    listAdmin(): AdminRelease[] { return db.prepare<[], Row>("select * from releases order by coalesce(published_at,created_at) desc,id desc").all().map(releaseFromRow); },
    listPublished(): Release[] {
      return db.prepare<[], Row>("select * from releases where published_at is not null order by published_at desc,id desc limit 20").all().map(row => publishedRelease(releaseFromRow(row)));
    },
    createDraft(input: unknown): AdminRelease {
      const value = validateReleaseWrite(input), id = randomUUID(), now = Date.now();
      return db.transaction(() => {
        unique(value.version, id);
        db.prepare("insert into releases(id,version,title,major,highlights_json,sections_json,created_at,updated_at) values(?,?,?,?,?,?,?,?)")
          .run(id, value.version, value.title, value.major ? 1 : 0, JSON.stringify(value.highlights), JSON.stringify(value.sections), now, now);
        return find(id);
      }).immediate();
    },
    editDraft(id: string, input: unknown): AdminRelease {
      return db.transaction(() => {
        const current = find(id);
        if (current.status !== "draft") throw new ReleaseError("release_immutable", 409);
        if (!input || typeof input !== "object" || Array.isArray(input)) throw new ReleaseError("invalid_release");
        const value = validateReleaseWrite({ ...current, ...input }); unique(value.version, id);
        db.prepare("update releases set version=?,title=?,major=?,highlights_json=?,sections_json=?,updated_at=? where id=?")
          .run(value.version, value.title, value.major ? 1 : 0, JSON.stringify(value.highlights), JSON.stringify(value.sections), Date.now(), id);
        return find(id);
      }).immediate();
    },
    publish(id: string, options: { actorUserId: number; autoEmail?: boolean }): AdminRelease {
      return db.transaction(() => {
        const release = find(id);
        if (release.status === "published") return release;
        const now = Date.now(), auto = release.major && (options.autoEmail ?? true);
        db.prepare("update releases set published_at=?,auto_email=?,updated_at=? where id=?").run(now, auto ? 1 : 0, now, id);
        const published = find(id);
        if (auto) {
          db.prepare(`insert into release_email_sends(id,release_id,owner_user_id,confirmed_at,release_json,template_version,status,available_at)
            values(?,?,?,?,?,'release-v1','preparing',?) on conflict(release_id) do nothing`)
            .run(randomUUID(), id, options.actorUserId, now, JSON.stringify(publishedRelease(published)), now);
        }
        return published;
      }).immediate();
    },
    lastSeenVersion(userId: number): string | null {
      return db.prepare<[number], { version: string }>("select r.version from release_seen s join releases r on r.id=s.release_id where s.user_id=?").get(userId)?.version ?? null;
    },
    markSeen(userId: number, version: unknown): void {
      if (typeof version !== "string") throw new ReleaseError("invalid_version");
      db.transaction(() => {
        const release = db.prepare<[string], { id: string; version: string }>("select id,version from releases where version=? and published_at is not null").get(version);
        if (!release) throw new ReleaseError("unknown_version", 400);
        const seen = this.lastSeenVersion(userId);
        if (seen && compareVersions(release.version, seen) <= 0) return;
        db.prepare("insert into release_seen(user_id,release_id,updated_at) values(?,?,?) on conflict(user_id) do update set release_id=excluded.release_id,updated_at=excluded.updated_at")
          .run(userId, release.id, Date.now());
      }).immediate();
    },
  };
}
