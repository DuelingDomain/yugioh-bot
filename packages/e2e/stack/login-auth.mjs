/**
 * Issue the signed E2E cookie into the same cookie jar the browser will use.
 * @param {import("@playwright/test").APIRequestContext} api
 * @param {{ userId: number }} player
 * @param {string} secret
 * @param {string} webUrl
 */
export async function authenticatePlayer(api, player, secret, webUrl) {
  const response = await api.post("/api/test-auth/session", {
    data: { userId: player.userId, secret },
  });
  if (response.status() !== 200) throw new Error(`E2E login returned HTTP ${response.status()}.`);
  const sessionResponse = await api.get("/api/auth/session");
  if (!sessionResponse.ok()) throw new Error(`Session endpoint returned HTTP ${sessionResponse.status()}.`);
  const session = await sessionResponse.json();
  if (session?.user?.id !== String(player.userId)) throw new Error("E2E login did not create the requested player session. Restart the manual stack and try again.");
}
