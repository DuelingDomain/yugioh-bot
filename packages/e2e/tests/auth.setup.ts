import { request as playwrightRequest, test as setup, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { authDir, players, webUrl } from "../stack/env.mjs";
import { authFile } from "../helpers/players";
import { authenticatePlayer } from "../stack/login-auth.mjs";

mkdirSync(authDir, { recursive: true });

// Issue each seeded user's signed E2E cookie and verify application identity. No browser needed.
for (const player of players) {
  setup(`log in ${player.key}`, async () => {
    const api = await playwrightRequest.newContext({ baseURL: webUrl });
    try {
      await authenticatePlayer(api, player, process.env.E2E_AUTH_SECRET ?? "", webUrl);
      const state = await api.storageState({ path: authFile(player.key) });
      expect(state.cookies.some((cookie) => cookie.name === "dd_e2e_session")).toBe(true);
    } finally {
      await api.dispose();
    }
  });
}
