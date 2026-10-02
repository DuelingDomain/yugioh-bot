/**
 * Sign in through the E2E provider, with the same cookie jar the browser will use.
 * @param {import("@playwright/test").APIRequestContext} api
 * @param {{ discordId: string, name: string }} player
 * @param {string} secret
 * @param {string} webUrl
 */
export async function authenticatePlayer(api, player, secret, webUrl) {
  const csrf = await api.get("/api/auth/csrf");
  if (!csrf.ok()) throw new Error(`CSRF endpoint returned HTTP ${csrf.status()}. Is the manual stack ready?`);
  const { csrfToken } = await csrf.json();
  if (!csrfToken) throw new Error("The manual stack did not return a CSRF token.");
  const response = await api.post("/api/auth/callback/e2e", {
    form: { csrfToken, discordId: player.discordId, name: player.name, secret, callbackUrl: webUrl },
    maxRedirects: 0,
  });
  if (![200, 302].includes(response.status())) throw new Error(`E2E login returned HTTP ${response.status()}.`);
  const sessionResponse = await api.get("/api/auth/session");
  if (!sessionResponse.ok()) throw new Error(`Session endpoint returned HTTP ${sessionResponse.status()}.`);
  const session = await sessionResponse.json();
  if (session.user?.id !== player.discordId) throw new Error("E2E login did not create the requested player session. Restart the manual stack and try again.");
}
