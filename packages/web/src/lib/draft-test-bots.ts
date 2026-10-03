/**
 * Test bots (the lobby's Add bot button and POST /api/drafts/[slug]/join-bot) are off in
 * production. They open when DRAFT_TEST_BOTS=1 is set in the web server's environment (read at
 * request time), or in any non-production build. Only the server reads this: the draft API hands
 * the answer to the page, so no NEXT_PUBLIC variable is involved.
 */
export function draftTestBotsEnabled(): boolean {
  return process.env.DRAFT_TEST_BOTS === "1" || process.env.NODE_ENV !== "production";
}
