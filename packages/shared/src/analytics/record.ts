import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { propertyKeys, type ProductEventName, type ProductEventProps } from "./events.js";

export function recordProductEvent<N extends ProductEventName>(db: Database.Database, name: N, userId: number | null, props?: ProductEventProps[N]): void {
  if (name !== "$delete_person" && userId !== null) {
    const user = db.prepare("select username from users where id=?").get(userId) as { username: string } | undefined;
    if (!user || user.username === `deleted-${userId}`) return;
  }
  const properties = Object.fromEntries(propertyKeys[name].filter(key => props?.[key] !== undefined).map(key => [key, props![key]]));
  db.prepare("insert into product_events(name,user_id,props_json,occurred_at,event_uuid) values(?,?,?,?,?)")
    .run(name, userId, JSON.stringify(properties), Date.now(), randomUUID());
}
