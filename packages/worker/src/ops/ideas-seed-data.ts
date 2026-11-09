interface IdeaSeed {
  seedKey: string;
  title: string;
  pitch: string | null;
  area: string;
  state: "open" | "in_progress" | "done";
  shippedWeek: string | null;
}

// Approved Ideas spec, with the one-line pitches from approach-a.html.
const teamIdeas: readonly [string, string, string, string, "open" | "in_progress"][] = [
  ["NT-102", "Ranked queue", "Find a Standard or Domain match near your rating.", "Ranked", "open"],
  ["NT-103", "Placement series", "Your first five rated series move your rating faster.", "Ranked", "open"],
  ["NT-104", "Separate Standard and Domain ratings", "Each format gets its own rating and tier.", "Ranked", "open"],
  ["NT-105", "Seasons with a soft reset", "A new season every 8 weeks. Ratings move halfway back to 1000.", "Ranked", "open"],
  ["NT-106", "Season crest and seat frame", "Your best tier each season becomes a crest and a seat frame.", "Ranked", "open"],
  ["NT-107", "Ladder sorted by rating", "Sort the leaderboard by rating as well as winnings.", "Ranked", "open"],
  ["NT-108", "Swiss rounds with a top cut", "Play rounds against equal records, then a top 4 or 8 bracket.", "Tournaments", "open"],
  ["NT-109", "Friends and playing now", "Add friends, see who is online, and challenge in one tap.", "Community", "open"],
  ["NT-110", "Share a deck or cube by link", "A read-only page anyone signed in can view and copy.", "Decks & cubes", "open"],
  ["NT-111", "Jump in from your own replays", "Stop a replay where it went wrong and play on from there.", "Replays & watching", "open"],
  ["NT-112", "Quick reactions in duels", "A fixed set of short reactions with a mute. No free chat.", "Duels", "open"],
  ["NT-113", "A practice bot that plays a real deck", "Pick a saved deck for the practice bot to play.", "Duels", "open"],
  ["NT-114", "Draft recap", "Step through every pack you saw after a draft.", "Drafts", "open"],
  ["NT-115", "Inbox for challenges, round calls and updates", "One place for challenges, round calls and draft starts.", "App", "open"],
  ["NT-116", "Theme drafts", "Each player drafts from a cube theme assigned to them.", "Drafts", "in_progress"],
  ["NT-117", "Card details that fit on a phone", "Card text, clock names and lobby wording stop getting cut off.", "App", "in_progress"],
  ["NT-118", "Readable text everywhere", "Nothing in the app smaller than 11px.", "App", "open"],
  ["NT-119", "Clear, consistent format names", "Standard, Domain and Genesys read the same on every screen.", "App", "open"],
];

// product-brief.md 5e: preserve each complete shipped line and its Monday week.
// These fixed row positions are persistent keys; do not reorder them.
const shippedWeeks: readonly [string, readonly [string, string][]][] = [
  ["2026-10-19", [
    ["Search cards by what they do: effects, partners, counters, release dates and format staples.", "Decks & cubes"],
    ["See live card statuses, protections and counters on the board.", "Duels"],
    ["Get legal deck suggestions and start a Test duel straight from the editor.", "Decks & cubes"],
    ["Hosts can remove players before a table starts, and replays load faster.", "Duels"],
    ["Fixed: decision clocks, Damage Step timing, card sorting and multiplayer LP effects.", "Duels"],
  ]],
  ["2026-10-12", [
    ["Import decks in bulk, with better previews and an editor that fits your screen.", "Decks & cubes"],
    ["Build and play Genesys decks with point budgets.", "Decks & cubes"],
    ["Replay older games even after engine updates.", "Replays & watching"],
  ]],
  ["2026-10-05", [
    ["Make drafts and tournaments open or private, with invitations.", "Drafts"],
    ["Follow each chain link as it resolves, with a table log and negation marks.", "Duels"],
  ]],
  ["2026-09-28", [
    ["Play Tag 2v2 and three- or four-player free-for-all.", "Duels"],
    ["Export draft decks and turn a finished draft into a tournament.", "Drafts"],
  ]],
];

export const IDEAS_SEEDS: readonly IdeaSeed[] = [
  ...teamIdeas.map(([seedKey, title, pitch, area, state]) => ({ seedKey, title, pitch, area, state, shippedWeek: null })),
  ...shippedWeeks.flatMap(([shippedWeek, rows]) => rows.map(([title, area], index) => ({
    seedKey: `shipped-${shippedWeek}-${String(index + 1).padStart(2, "0")}`,
    title, pitch: null, area, state: "done" as const, shippedWeek,
  }))),
];
