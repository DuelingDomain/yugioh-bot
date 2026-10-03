/* Shared fake data for the three tournament concepts. Same six people as the Cube night draft mock.
   Every concept reads from here, so the owner compares designs, not data.

   TourData.snapshot(format, state, opts) returns a fresh object:
     format: "round_robin" | "single_elim"
     state:  "lobby" | "live" | "confirm" | "done"
     opts:   { viewer: "player" | "spectator", host: boolean }
   TourData.nextEvent(snap) applies the next "a result comes in" event to snap (mutates it)
     and returns the event, or null when there are no more. Re-derive standings after it.
   TourData.standings(snap)  rows sorted by wins, then fewest losses (round robin), with shared ranks.
   TourData.stakes(me, opp)  { win, lose } Elo change for `me`, K = 32, same formula as the app.

   Facts the designs must respect (they match the real app):
   - Tournament games are private. There is no "watch" link for a live match, only its game score.
   - Deck status is only "Deck in" or "No deck yet". Never show another player's deck name or cards.
   - No avatars exist. Use the monogram and ring colour.
   - Single elimination: a round's next round is drawn only when every match in it is finished.
     Winners are paired in match order; with an odd number left, the first winner gets a bye.
   - A reported result waits for the other player to confirm (or deny) within the confirm window
     (24 hours here). If nobody acts, it confirms itself when the window ends.
*/
(function (g) {
  const PLAYERS = [
    { id: 1, name: "Imran", mono: "Im", ring: "#9b7eff", tier: "Gold", elo: 1186, you: true },
    { id: 2, name: "Kestrel", mono: "Ke", ring: "#c86fd0", tier: "Platinum", elo: 1402 },
    { id: 3, name: "Marik_Mains", mono: "MM", ring: "#5fbf7f", tier: "Diamond", elo: 1655 },
    { id: 4, name: "voidpriest", mono: "Vo", ring: "#6f8fe0", tier: "Silver", elo: 1043 },
    { id: 5, name: "duel.josh", mono: "DJ", ring: "#4fb39a", tier: "Gold", elo: 1120 },
    { id: 6, name: "BlueEyesBen", mono: "BE", ring: "#c9c25a", tier: "Bronze", elo: 880 },
  ];

  const TIER_COLOUR = { Diamond: "#9fd8ff", Platinum: "#c9d3e0", Gold: "#e4b64f", Silver: "#aab1bb", Bronze: "#c98a5a" };

  const TOURNAMENT = {
    name: "Friday cube night",
    subtitle: "The duels",
    fromDraft: "Friday cube night", // made from the draft; links back to it
    bestOf: 3,
    rules: [
      ["Format", null], // filled per format
      ["Games", "Best of 3"],
      ["Decks", "Your draft deck"],
      ["Turn time", "4 min"],
      ["Confirm window", "24 hours"],
      ["Closes", "No deadline"],
    ],
    host: 1, // Imran made it
    started: "8:30 PM",
    inviteLink: "duelistskingdom.com/t/friday-cube-night",
  };

  // m(id, round, p1, p2, status, games [p1 wins, p2 wins], extra)
  // status: "open" (not started), "live" (a game is being played), "between" (between games),
  //         "reported" (waiting for the other player to confirm), "done", "bye"
  function m(id, round, p1, p2, status, games, extra) {
    const out = { id, round, p1, p2, status, games: games || [0, 0], winner: null, reporter: null, confirmHoursLeft: null, at: null, game: null };
    if (status === "done" || status === "reported") out.winner = games[0] > games[1] ? p1 : p2;
    if (status === "bye") out.winner = p1;
    return Object.assign(out, extra || {});
  }

  const RR = {
    lobby: [],
    live: [
      m(1, 1, 1, 6, "done", [2, 0], { at: "8:52 PM" }),
      m(2, 1, 2, 5, "done", [2, 1], { at: "9:04 PM" }),
      m(3, 1, 3, 4, "done", [2, 0], { at: "8:49 PM" }),
      m(4, 2, 1, 3, "done", [1, 2], { at: "9:31 PM" }),
      m(5, 2, 2, 6, "done", [2, 0], { at: "9:18 PM" }),
      m(6, 2, 4, 5, "done", [2, 1], { at: "9:40 PM" }),
      m(7, 3, 1, 2, "open", [0, 0]),
      m(8, 3, 3, 5, "between", [1, 0], { game: 2 }),
      m(9, 3, 4, 6, "reported", [2, 1], { reporter: 4, confirmHoursLeft: 23 }),
      m(10, 4, 1, 4, "open"), m(11, 4, 2, 3, "open"), m(12, 4, 5, 6, "open"),
      m(13, 5, 1, 5, "open"), m(14, 5, 2, 4, "open"), m(15, 5, 3, 6, "open"),
    ],
  };
  // You reported nothing; Kestrel reported beating you 2-1 and it waits on you.
  RR.confirm = RR.live.map((x) => (x.id === 7 ? m(7, 3, 1, 2, "reported", [1, 2], { reporter: 2, confirmHoursLeft: 23 }) : x));
  RR.done = [
    ...RR.live.slice(0, 6),
    m(7, 3, 1, 2, "done", [1, 2], { at: "9:58 PM" }),
    m(8, 3, 3, 5, "done", [2, 0], { at: "9:47 PM" }),
    m(9, 3, 4, 6, "done", [2, 1], { at: "9:44 PM" }),
    m(10, 4, 1, 4, "done", [2, 0], { at: "10:21 PM" }),
    m(11, 4, 2, 3, "done", [2, 1], { at: "10:30 PM" }),
    m(12, 4, 5, 6, "done", [2, 0], { at: "10:12 PM" }),
    m(13, 5, 1, 5, "done", [2, 1], { at: "10:55 PM" }),
    m(14, 5, 2, 4, "done", [2, 0], { at: "10:49 PM" }),
    m(15, 5, 3, 6, "done", [2, 0], { at: "10:41 PM" }),
  ];

  const SE = {
    lobby: [],
    // Round 1 still running (Kestrel v duel.josh in game 3), so round 2 is not drawn yet.
    live: [
      m(1, 1, 1, 6, "done", [2, 0], { at: "8:52 PM" }),
      m(2, 1, 2, 5, "live", [1, 1], { game: 3 }),
      m(3, 1, 3, 4, "done", [2, 1], { at: "9:06 PM" }),
    ],
  };
  // Confirm: the result waiting on you is your round 1 match. BlueEyesBen reported that you won 2-0.
  SE.confirm = [
    m(1, 1, 1, 6, "reported", [2, 0], { reporter: 6, confirmHoursLeft: 22 }),
    m(2, 1, 2, 5, "live", [1, 1], { game: 3 }),
    m(3, 1, 3, 4, "done", [2, 1], { at: "9:06 PM" }),
  ];
  SE.done = [
    m(1, 1, 1, 6, "done", [2, 0], { at: "8:52 PM" }),
    m(2, 1, 2, 5, "done", [2, 1], { at: "9:24 PM" }),
    m(3, 1, 3, 4, "done", [2, 1], { at: "9:06 PM" }),
    m(4, 2, 1, null, "bye", [0, 0]),
    m(5, 2, 2, 3, "done", [1, 2], { at: "10:02 PM" }),
    m(6, 3, 1, 3, "done", [1, 2], { at: "10:44 PM" }),
  ];

  // Who joined, and deck status, per state. Lobby: 4 of 6 in, two without decks yet.
  const LOBBY_JOINED = [1, 2, 3, 5];
  const LOBBY_NO_DECK = [3, 5];

  // "A result comes in" events, applied in order by nextEvent().
  const EVENTS = {
    round_robin: [
      { kind: "final", matchId: 8, games: [2, 0], at: "9:47 PM", text: "Marik_Mains beat duel.josh 2–0" },
      { kind: "confirmed", matchId: 9, at: "9:49 PM", text: "BlueEyesBen confirmed voidpriest's win, 2–1" },
      { kind: "game", matchId: 7, games: [1, 0], game: 2, text: "You took game 1 against Kestrel" }, // only fires in "live" after you start
    ],
    single_elim: [
      { kind: "final", matchId: 2, games: [2, 1], at: "9:24 PM", text: "Kestrel beat duel.josh 2–1",
        // round 1 is now finished, so round 2 is drawn: you (first winner) get the bye.
        draw: [m(4, 2, 1, null, "bye", [0, 0]), m(5, 2, 2, 3, "open", [0, 0])] },
      { kind: "game", matchId: 5, games: [1, 0], game: 2, text: "Kestrel took game 1 against Marik_Mains" },
      { kind: "final", matchId: 5, games: [1, 2], at: "10:02 PM", text: "Marik_Mains beat Kestrel 2–1",
        draw: [m(6, 3, 1, 3, "open", [0, 0])] },
    ],
  };

  const FEED_BASE = {
    // newest first; derived from done matches in each snapshot, plus these non-result lines
    extra: [{ at: "8:30 PM", text: "Imran started the tournament" }],
  };

  function clone(x) { return JSON.parse(JSON.stringify(x)); }

  function snapshot(format, state, opts) {
    opts = Object.assign({ viewer: "player", host: false }, opts);
    const table = format === "single_elim" ? SE : RR;
    const players = clone(PLAYERS).map((p) => {
      const joined = state !== "lobby" || LOBBY_JOINED.includes(p.id);
      return Object.assign(p, {
        joined,
        deck: state === "lobby" ? (LOBBY_NO_DECK.includes(p.id) ? "none" : "in") : "in",
        you: opts.viewer === "player" && p.id === 1,
      });
    });
    const status = state === "lobby" ? "pending" : state === "done" ? "completed" : "active";
    const t = clone(TOURNAMENT);
    t.format = format;
    t.formatLabel = format === "single_elim" ? "Single elimination" : "Round robin";
    t.rules[0][1] = t.formatLabel;
    t.status = status;
    t.rounds = format === "single_elim" ? 3 : 5;
    const snap = {
      tournament: t,
      players: players.filter((p) => p.joined),
      matches: clone(table[state] || []),
      viewer: opts.viewer,
      youId: opts.viewer === "player" ? 1 : null,
      host: !!opts.host,
      eventIndex: 0,
      feed: [],
    };
    snap.feed = deriveFeed(snap);
    return snap;
  }

  function deriveFeed(snap) {
    const name = (id) => PLAYERS.find((p) => p.id === id).name;
    const out = snap.matches
      .filter((x) => x.status === "done" && x.at)
      .map((x) => {
        const w = x.winner, l = w === x.p1 ? x.p2 : x.p1;
        const hi = Math.max(...x.games), lo = Math.min(...x.games);
        return { at: x.at, text: `${name(w)} beat ${name(l)} ${hi}–${lo}`, matchId: x.id };
      });
    if (snap.tournament.status !== "pending") out.push(...FEED_BASE.extra);
    return out.sort((a, b) => toMin(b.at) - toMin(a.at));
  }
  function toMin(s) { const [h, rest] = s.split(":"); const mm = parseInt(rest, 10); const pm = /PM/.test(s); return ((+h % 12) + (pm ? 12 : 0)) * 60 + mm; }

  function nextEvent(snap) {
    const list = EVENTS[snap.tournament.format];
    while (snap.eventIndex < list.length) {
      const ev = clone(list[snap.eventIndex++]);
      const mt = snap.matches.find((x) => x.id === ev.matchId);
      if (!mt || mt.status === "done" || mt.status === "bye") continue;
      if (ev.kind === "final") {
        mt.games = ev.games; mt.status = "done"; mt.at = ev.at;
        mt.winner = ev.games[0] > ev.games[1] ? mt.p1 : mt.p2; mt.game = null;
        if (ev.draw) snap.matches.push(...ev.draw);
      } else if (ev.kind === "confirmed") {
        if (mt.status !== "reported") continue;
        mt.status = "done"; mt.at = ev.at; mt.reporter = null; mt.confirmHoursLeft = null;
      } else if (ev.kind === "game") {
        if (mt.status === "open" && snap.youId && (mt.p1 === snap.youId || mt.p2 === snap.youId)) continue; // you haven't started it
        mt.games = ev.games; mt.status = "between"; mt.game = ev.game;
      }
      snap.feed = deriveFeed(snap);
      return ev;
    }
    return null;
  }

  function standings(snap) {
    const rows = snap.players.map((p) => ({ player: p, wins: 0, losses: 0, played: 0, live: false }));
    const by = (id) => rows.find((r) => r.player.id === id);
    for (const x of snap.matches) {
      if (x.status === "live" || x.status === "between") { by(x.p1).live = true; if (x.p2) by(x.p2).live = true; }
      if (x.status !== "done") continue;
      const l = x.winner === x.p1 ? x.p2 : x.p1;
      by(x.winner).wins++; by(l).losses++; by(x.winner).played++; by(l).played++;
    }
    rows.sort((a, b) => b.wins - a.wins || a.losses - b.losses || b.player.elo - a.player.elo);
    rows.forEach((r, i) => { r.rank = i > 0 && rows[i - 1].wins === r.wins && rows[i - 1].losses === r.losses ? rows[i - 1].rank : i + 1; });
    return rows;
  }

  function stakes(me, opp) {
    const e = 1 / (1 + Math.pow(10, (opp.elo - me.elo) / 400));
    return { win: Math.round(32 * (1 - e)), lose: -Math.round(32 * e) };
  }

  g.TourData = { PLAYERS, TIER_COLOUR, snapshot, nextEvent, standings, stakes, player: (id) => PLAYERS.find((p) => p.id === id) };
})(window);
