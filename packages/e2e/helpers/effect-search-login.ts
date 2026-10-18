import { expect, type APIRequestContext } from "@playwright/test";
import { players, webUrl } from "../stack/env.mjs";

export async function signInEffectSearch(api: APIRequestContext) {
  const { csrfToken } = await (await api.get("/api/auth/csrf")).json();
  const player = players[0];
  const response = await api.post("/api/auth/callback/e2e", {
    form: { csrfToken, discordId: player.discordId, name: player.name,
      secret: process.env.E2E_AUTH_SECRET ?? "", callbackUrl: webUrl },
    maxRedirects: 0,
  });
  expect([200, 302]).toContain(response.status());
  expect((await (await api.get("/api/auth/session")).json()).user?.id).toBe(player.discordId);
}
