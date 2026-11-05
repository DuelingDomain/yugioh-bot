import type { Release } from "../src/lib/updates/types";

/** Three releases, newest first, as GET /api/releases sends them. */
export const releases: Release[] = [
  {
    id: "r3", version: "0.2.2", title: "Dueling Domain v0.2.2", major: true, publishedAt: "2026-11-04T09:00:00Z",
    highlights: [
      "**Synergy search** shows two groups: “Archetype cards” and “Works with”.",
      "New **FAQ page**. The trailer now plays in a large window.",
      "The **Suggest tab** gives better picks.",
      "The Challenge button is gone. Use **Create game**.",
      "Weekly card data update.",
      "Banished cards that return now come back correctly.",
    ],
    sections: [
      { kind: "new", items: [
        "**Synergy search groups.** Search results now come in two groups: “Archetype cards” and “Works with”.",
        "**FAQ page.** Answers to the questions players ask most, in one place.",
        "**Large trailer window.** The trailer now opens in a large window, so you can see the field clearly.",
      ] },
      { kind: "improvements", items: [
        "**Better Suggest picks.** The Suggest tab in the deck builder now gives cards that fit your deck better.",
        "**Challenge button removed.** To start a duel with a friend, use **Create game** and send the invite.",
      ] },
      { kind: "cards", items: ["**Weekly card data update.** New cards and script fixes from this week are in the engine."] },
      { kind: "fixes", items: ["**Banished cards.** A banished card that returns to the field now comes back correctly."] },
      { kind: "howto", items: ["Open a deck in **Decks**.", "Type an archetype name in search.", "Look at “Archetype cards” first, then “Works with”."] },
    ],
  },
  {
    id: "r2", version: "0.2.1", title: "Dueling Domain v0.2.1", major: false, publishedAt: "2026-10-24T09:00:00Z",
    highlights: ["**Card status and counters.** A rail on the card edge shows status."],
    sections: [
      { kind: "new", items: ["**Card status and counters.** A rail on the card edge shows status, and counters stack with their own icons."] },
      { kind: "improvements", items: ["Lower LP rules in multiplayer now compare you with all living opponents."] },
      { kind: "fixes", items: ["Tagging on Discord works again."] },
    ],
  },
  {
    id: "r1", version: "0.2.0", title: "Dueling Domain v0.2.0", major: true, publishedAt: "2026-10-20T09:00:00Z",
    highlights: ["**Admin console** for the live view of the server."],
    sections: [
      { kind: "new", items: ["**Admin console** for the live view of the server.", "**Card inspector** in a left drawer: hover to show, click to pin."] },
      { kind: "cards", items: ["October 2026 TCG and OCG ban lists."] },
      { kind: "fixes", items: ["Live duels close after 10 minutes with no action."] },
    ],
  },
];
