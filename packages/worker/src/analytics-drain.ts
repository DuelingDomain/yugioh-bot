import type Database from "better-sqlite3";
import type { ProductEventName } from "@yugidraft/shared/analytics";

interface ProductEventRow {
  id: number;
  name: ProductEventName;
  user_id: number | null;
  props_json: string;
  occurred_at: number;
  attempts: number;
  event_uuid: string;
}

export async function drainProductEvents(db: Database.Database, options: {
  key: string;
  host?: string;
  personalApiKey: string;
  projectId: string;
}): Promise<void> {
  if (!options.key) {
    db.prepare("delete from product_events").run();
    return;
  }
  const now = Date.now();
  db.prepare("delete from product_events where sent_at < ? or (sent_at is null and occurred_at < ?)")
    .run(now - 7 * 86400_000, now - 30 * 86400_000);
  const rows = db.prepare<[number], ProductEventRow>(`
    select * from product_events where sent_at is null and attempts < 10 and next_attempt_at <= ? order by id limit 100
  `).all(now);
  const host = (options.host || "https://eu.i.posthog.com").replace(/\/+$/, "");
  const markSent = db.prepare("update product_events set sent_at=? where id=?");
  const retry = db.prepare("update product_events set attempts=attempts+1,next_attempt_at=? where id=?");
  const failed = (rows: ProductEventRow[]) => {
    db.transaction(() => {
      for (const row of rows) retry.run(Date.now() + 10_000 * 2 ** row.attempts, row.id);
    })();
    console.warn("[analytics] delivery deferred");
  };
  async function request(url: string, init: RequestInit): Promise<Response> {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error("Analytics request failed");
    return response;
  }

  const events = rows.filter(row => row.name !== "$delete_person");
  if (events.length > 0) {
    try {
      await request(`${host}/batch/`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: options.key, batch: events.map(row => ({
          event: row.name,
          timestamp: new Date(row.occurred_at).toISOString(),
          properties: {
            ...JSON.parse(row.props_json),
            distinct_id: row.user_id === null ? `anonymous:${row.event_uuid}` : String(row.user_id),
            $insert_id: row.event_uuid,
            $process_person_profile: row.user_id !== null,
          },
        })) }),
      });
      db.transaction(() => { for (const row of events) markSent.run(Date.now(), row.id); })();
    } catch { failed(events); }
  }

  for (const row of rows.filter(row => row.name === "$delete_person")) {
    try {
      if (!options.personalApiKey || !options.projectId) throw new Error("Person deletion is not configured");
      const apiHost = host.replace("https://eu.i.posthog.com", "https://eu.posthog.com");
      const url = `${apiHost}/api/projects/${encodeURIComponent(options.projectId)}/persons/`;
      const headers = { Authorization: `Bearer ${options.personalApiKey}` };
      const response = await request(`${url}?distinct_id=${encodeURIComponent(String(row.user_id))}`, { headers });
      const people = await response.json() as { results: { id: string; distinct_ids: string[] }[] };
      const matches = people.results.filter(person => person.distinct_ids.includes(String(row.user_id)));
      if (matches.length === 0) throw new Error("Person deletion is pending");
      for (const person of matches) {
        await request(`${url}${encodeURIComponent(person.id)}/?delete_events=true`, { method: "DELETE", headers });
      }
      markSent.run(Date.now(), row.id);
    } catch { failed([row]); }
  }
}
