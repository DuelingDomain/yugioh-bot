/** What `/waitlist?s=` can say. "form" is the plain email form; every other value is a finished state from the Discord path. */
export type WaitlistView = "form" | "joined" | "invited" | "account" | "retry";
// Plain module (not "use client"), so the server page can read the list.
export const WAITLIST_VIEWS: readonly WaitlistView[] = ["form", "joined", "invited", "account", "retry"];
