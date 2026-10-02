import { request as playwrightRequest, test as setup, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { authDir, players, webUrl } from "../stack/env.mjs";
import { authFile } from "../helpers/players";

mkdirSync(authDir, { recursive: true });

// Log each test player in once through the test-only credentials provider. No browser needed.
for (const player of players) {
  setup(`log in ${player.key}`, async () => {
    const api = await playwrightRequest.newContext({ baseURL: webUrl });
    const { csrfToken } = await (await api.get("/api/auth/csrf")).json();
    const response = await api.post("/api/auth/callback/e2e", {
      form: {
        csrfToken,
        discordId: player.discordId,
        name: player.name,
        secret: process.env.E2E_AUTH_SECRET ?? "",
        callbackUrl: webUrl,
      },
      maxRedirects: 0,
    });
    expect([200, 302]).toContain(response.status());
    const session = await (await api.get("/api/auth/session")).json();
    expect(session.user?.id).toBe(player.discordId);
    await api.storageState({ path: authFile(player.key) });
    await api.dispose();
  });
}
