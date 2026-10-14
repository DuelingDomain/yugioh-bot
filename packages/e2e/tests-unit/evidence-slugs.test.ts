import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import type { BrowserContext } from "@playwright/test";
import { PlayerEvidence } from "../helpers/evidence.ts";

test("startup assets do not create extra duels that skip the privacy scan", () => {
  const context = new EventEmitter();
  const page = new EventEmitter();
  const evidence = new PlayerEvidence("p5", context as unknown as BrowserContext, Date.now());
  context.emit("page", page);
  for (const path of [
    "/_next/static/chunks/app/(app)/duels/[slug]/page.js",
    "/_next/static/chunks/app/(app)/duels/new/page.js",
    "/api/duels/cards",
    "/duels/new",
    "/api/duels/loss-room/connection",
    "/duels/loss-room?window=1",
    "/api/duels/loss-room",
  ]) page.emit("request", { url: () => `http://fixture.test${path}` });
  assert.deepEqual(evidence.slugs, ["loss-room"]);
});
