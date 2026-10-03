/* Concept D, version 2: Solid Vision. The round is a set of fields of projected light.
   Your match is the big tilted field (your row of zones is your rounds, a win is a gold locator card lying in
   that round's zone). Every other match in the round is a small flat field under it. Anyone can watch a live
   duel, and results arrive from the duel system. Everything reads from data.js (TourData). The one
   orchestrated moment (a locator card is projected and claimed) lives in comeIn() near the bottom. */
const _snap = TourData.snapshot;
TourData.snapshot = (...a) => {
  const s = _snap(...a);
  Object.assign(s.tournament, { name: "Cube cup 4", fromDraft: "Cube draft 4", inviteLink: "duelistskingdom.com/t/cube-cup-4" });
  // Mock data override: in the round-robin live and confirm snapshots nothing is mid-game, so there would be nothing
  // to watch. Match 8 (Marik_Mains v duel.josh) is in game 2. data.js is not edited.
  if (s.tournament.format === "round_robin" && s.tournament.status === "active") {
    const m8 = s.matches.find((x) => x.id === 8);
    if (m8) Object.assign(m8, { status: "live", games: [1, 0], game: 2 });
  }
  // Mock-only test hook: ?rounds=11 pretends the tournament has 11 rounds (a 12-player round robin) so the
  // five-zone window on the big field can be checked. Not part of the design.
  const rq = parseInt(new URLSearchParams(location.search).get("rounds"), 10);
  if (rq > 0) s.tournament.rounds = rq;
  return s;
};

(() => {
  "use strict";
  const TD = window.TourData;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const MINUS = "−";
  const params = new URLSearchParams(location.search);
  const root = document.documentElement;
  const BEAM = "rgb(198 182 255)";

  /* ---------- settings ---------- */
  const S = {
    format: params.get("format") === "single_elim" ? "single_elim" : "round_robin",
    state: ["lobby", "live", "confirm", "done"].includes(params.get("state")) ? params.get("state") : "live",
    viewer: params.get("viewer") === "spectator" ? "spectator" : "player",
    host: params.get("host") === "1" || params.get("host") === "true",
  };
  let drawerOpen = false, popOpen = false, demoOpen = false, busy = false;
  let snap = null;
  let lastScores = {};
  let heroMid = 0;
  let hold = null; // while a result is playing out, the round whose tables stay on screen
  let ro = {};     // options of the render in progress

  function readMotion() {
    const q = params.get("anim");
    if (["full", "calm", "off"].includes(q)) return q;
    try { const v = localStorage.getItem("yd-anim"); if (["full", "calm", "off"].includes(v)) return v; } catch (e) { /* storage unavailable */ }
    return matchMedia("(prefers-reduced-motion: reduce)").matches ? "calm" : "full";
  }
  const motion = () => root.dataset.motion;
  function setMotion(level, save) {
    root.dataset.motion = level;
    if (save) { try { localStorage.setItem("yd-anim", level); } catch (e) { /* ignore */ } }
  }
  setMotion(readMotion(), false);

  /* ---------- small helpers ---------- */
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const pl = (id) => snap.players.find((p) => p.id === id) || TD.player(id);
  const youId = () => snap.youId;
  const isYou = (id) => !!id && id === snap.youId;
  const toMin = (s) => { const [h, rest] = s.split(":"); const mm = parseInt(rest, 10); const pm = /PM/.test(s); return ((+h % 12) + (pm ? 12 : 0)) * 60 + mm; };
  const fmtDelta = (n) => (n < 0 ? MINUS + Math.abs(n) : "+" + n);
  const hiLo = (g) => `${Math.max(...g)}\u2060–\u2060${Math.min(...g)}`;
  const other = (m, id) => (m.p1 === id ? m.p2 : m.p1);
  const realMatches = () => snap.matches.filter((m) => m.p2 && m.status !== "bye");
  const isSE = () => snap.tournament.format === "single_elim";
  const roundName = (r) => (isSE() ? ["Round 1", "Round 2", "Final"][r - 1] || "Round " + r : "Round " + r);
  const hoursWord = (n) => `${n} hour${n === 1 ? "" : "s"}`;
  const nameList = (ns) => (ns.length > 1 ? ns.slice(0, -1).join(", ") + " and " + ns[ns.length - 1] : ns[0] || "");

  const ICON = {
    back: '<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12.5 4.5 7 10l5.5 5.5"/></svg>',
    motion: '<svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M3 10h4l2-5 3 10 2-5h3"/></svg>',
    host: '<svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h12M4 10h12M4 14h12"/><circle cx="7" cy="6" r="1.6" fill="var(--ground)"/><circle cx="13" cy="10" r="1.6" fill="var(--ground)"/><circle cx="8" cy="14" r="1.6" fill="var(--ground)"/></svg>',
    star: '<svg class="star" viewBox="0 0 10 10" aria-hidden="true"><path d="M5 .6 6.2 3.6l3.2.3-2.4 2.1.8 3.1L5 7.6 2.2 9.1 3 6 .6 3.9l3.2-.3z" fill="currentColor"/></svg>',
    clock: '<svg class="clk" viewBox="0 0 10 10" aria-hidden="true"><circle cx="5" cy="5" r="4.2" fill="#0a1120" stroke="currentColor" stroke-width="1"/><path d="M5 2.6V5l1.6 1" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round"/></svg>',
  };

  const mono = (p, extra) => `<span class="mono ${extra || ""}" style="--ring:${p.ring}" aria-hidden="true">${esc(p.mono)}</span>`;
  const gem = (tier) => `<i class="gem" style="--g:${TD.TIER_COLOUR[tier] || "#aab1bb"}" aria-hidden="true"></i>`;
  const tierLine = (p) => `<span class="tl">${gem(p.tier)}<span class="tw">${esc(p.tier)}</span> <em>${p.elo}</em></span>`;

  /* ---------- feed, standings, rounds ---------- */
  function feed() {
    const out = snap.matches
      .filter((x) => x.status === "done" && x.at)
      .map((x) => {
        const w = x.winner, l = other(x, w);
        return { at: x.at, text: `${pl(w).name} beat ${pl(l).name} ${hiLo(x.games)}`, matchId: x.id };
      });
    snap.feed.filter((f) => !f.matchId).forEach((f) => out.push({ at: f.at, text: f.text, matchId: 0 }));
    return out.sort((a, b) => toMin(b.at) - toMin(a.at));
  }
  const stand = () => TD.standings(snap);
  const recOf = (pid) => { const r = stand().find((x) => x.player.id === pid); return r ? `${r.wins}–${r.losses}` : "0–0"; };

  function currentRound() {
    const open = snap.matches.filter((m) => m.status !== "done" && m.status !== "bye");
    if (open.length) return Math.min(...open.map((m) => m.round));
    return snap.tournament.rounds;
  }
  function champion() {
    if (snap.tournament.status !== "completed") return null;
    if (isSE()) {
      const fin = snap.matches.filter((m) => m.status === "done").sort((a, b) => b.round - a.round)[0];
      return fin ? pl(fin.winner) : null;
    }
    return stand()[0].player;
  }

  /* ---------- zones: one per round, for one player ---------- */
  function zoneDesc(pid, r) {
    const m = snap.matches.find((x) => x.round === r && (x.p1 === pid || x.p2 === pid));
    if (!m) return { r, kind: "none" };
    if (m.status === "bye") return { r, kind: "bye", m };
    const opp = pl(other(m, pid));
    let kind;
    if (m.status === "done") kind = m.winner === pid ? "win" : "loss";
    else if (m.status === "reported") kind = m.winner === pid ? "pwin" : "ploss";
    else if (m.status === "live" || m.status === "between") kind = "now";
    else kind = m.id === heroMid ? "now" : "open";
    return { r, kind, m, opp, pid };
  }
  function confirmer(m) { return other(m, m.reporter); }
  function tipFor(z) {
    const { kind, m, opp } = z;
    if (kind === "win") return `Beat ${opp.name} ${hiLo(m.games)}`;
    if (kind === "loss") return `Lost to ${opp.name} ${hiLo(m.games)}`;
    if (kind === "pwin" || kind === "ploss") return `Waiting for ${isYou(confirmer(m)) ? "you" : pl(confirmer(m)).name} to confirm`;
    if (kind === "now") return m.status === "live" || m.status === "between" ? `Playing ${opp.name} now` : `Plays ${opp.name} in ${roundName(z.r).toLowerCase()}`;
    if (kind === "open") return `Plays ${opp.name} in ${roundName(z.r).toLowerCase()}`;
    if (kind === "bye") return `Bye in ${roundName(z.r).toLowerCase()}`;
    return "";
  }
  function zoneLabel(z) {
    const { kind, opp } = z;
    let sub = "";
    if (kind === "win" || kind === "pwin") sub = `Beat ${opp.mono}`;
    else if (kind === "loss" || kind === "ploss") sub = `Lost to ${opp.mono}`;
    else if (kind === "bye") sub = "Bye";
    if (isSE()) {
      if (kind === "now") sub = "Now";
      if (kind === "bye") sub = "";
      return `<span class="zl"><span class="rn">${roundName(z.r)}</span><span class="rr">${esc(sub)}</span></span>`;
    }
    if (kind === "now") sub = `Round ${z.r}`;
    else if (kind === "open" || kind === "none") sub = `R${z.r}`;
    return `<span class="zl"><span class="rr">${esc(sub)}</span></span>`;
  }
  // o: { strip: no label, mini: small road card }
  function zone(z, o) {
    o = o || {};
    const tip = tipFor(z);
    const k = z.kind;
    let inner = "";
    if (k === "win" || k === "pwin") inner = `<span class="zc">${ICON.star}<b class="zm">${esc(z.opp.mono)}</b></span>${ICON.clock}`;
    else if (k === "loss" || k === "ploss") inner = `<span class="zc"></span>${ICON.clock}`;
    else if (k === "now" || k === "open") inner = `<b class="fm" style="--ring:${z.opp.ring}">${esc(z.opp.mono)}</b>`;
    else if (k === "bye" && !o.strip && !o.mini) inner = `<b class="zb">Bye</b>`;
    const key = z.m && z.pid ? ` data-slot="${z.pid}:${z.m.id}"` : "";
    const a11y = tip ? ` tabindex="0" role="img" aria-label="${esc(tip)}" data-tip="${esc(tip)}"` : "";
    const wide = isSE() && !o.strip && !o.mini ? " wide" : "";
    return `<div class="zn ${k}${wide}${o.strip ? " strip-z" : ""}${o.mini ? " mini" : ""}"${key}${a11y}><span class="zbox">${inner}</span>${o.strip || o.mini ? "" : zoneLabel(z)}</div>`;
  }
  /* The round row of a field shows at most 5 zones: the 2 rounds before the current one, the current round and the
     2 after it, with a small counter at each end for the rest ("Rounds 1 to 3: 2 wins"). A 12-player round robin has
     11 rounds, so this matters there. The mock's data has 5 rounds, so here the rule shows all 5 and no counter. */
  function roundWindow(total, cur) {
    if (total <= 5) return null;
    let lo = Math.max(1, cur - 2), hi = Math.min(total, cur + 2);
    if (hi - lo < 4) { if (lo === 1) hi = 5; else lo = total - 4; }
    return { lo, hi };
  }
  function rangeText(pid, a, b) {
    let wins = 0, played = 0;
    for (let r = a; r <= b; r++) { const k = zoneDesc(pid, r).kind; if (k === "win") { wins++; played++; } else if (k === "loss") played++; }
    const n = b - a + 1;
    const head = n > 1 ? `Rounds ${a} to ${b}` : `Round ${a}`;
    const tail = played ? `${wins} win${wins === 1 ? "" : "s"}` : `${n} to play`;
    return { full: `${head}: ${tail}`, short: tail };
  }
  const counter = (pid, a, b, o) => {
    const t = rangeText(pid, a, b);
    return `<span class="rcount${o.compact ? " compact" : ""}" tabindex="0" role="img" aria-label="${esc(t.full)}" data-tip="${esc(t.full)}">${esc(o.compact ? t.short : t.full)}</span>`;
  };
  // o.cur: the current round, to window the row (big field and medium fields). Without it every round shows.
  function zoneRow(pid, o) {
    o = o || {};
    const total = snap.tournament.rounds;
    const w = o.cur ? roundWindow(total, o.cur) : null;
    const lo = w ? w.lo : 1, hi = w ? w.hi : total;
    const out = [];
    if (w && lo > 1) out.push(counter(pid, 1, lo - 1, o));
    for (let r = lo; r <= hi; r++) out.push(zone(zoneDesc(pid, r), o));
    if (w && hi < total) out.push(counter(pid, hi + 1, total, o));
    return out.join("");
  }

  /* ---------- score digits (rolled by translateY in the moment) ---------- */
  function dg(key, v, cls) {
    const from = lastScores[key];
    const f = from !== undefined && String(from) !== String(v) ? ` data-from="${from}"` : "";
    return `<span class="dg${cls ? " " + cls : ""}" data-k="${key}" data-v="${v}"${f}><span class="dg-in"><b>${v}</b></span></span>`;
  }

  /* ---------- the hero model ---------- */
  function myMatch() {
    if (!youId()) return null;
    const pri = (m) => (m.status === "reported" ? 0 : m.status === "live" || m.status === "between" ? 1 : 2);
    return realMatches()
      .filter((m) => (m.p1 === youId() || m.p2 === youId()) && m.status !== "done")
      .sort((a, b) => pri(a) - pri(b) || a.round - b.round || a.id - b.id)[0] || null;
  }
  function heroModel() {
    const st = snap.tournament.status;
    if (st === "pending") return { mode: "lobby" };
    if (st === "completed") return { mode: "champ", champ: champion() };
    if (youId()) {
      const m = myMatch();
      if (m) return { mode: "match", m, near: pl(youId()), far: pl(other(m, youId())), mine: true };
      const me = pl(youId());
      const mineAll = snap.matches.filter((x) => x.p1 === youId() || x.p2 === youId()).sort((a, b) => b.round - a.round || b.id - a.id);
      const last = mineAll[0];
      if (!last) return { mode: "none", near: me };
      const undone = realMatches().filter((x) => x.status !== "done");
      const sameRound = undone.filter((x) => x.round === last.round).flatMap((x) => [pl(x.p1).name, pl(x.p2).name]);
      if (last.status === "bye" && sameRound.length) {
        const nextLabel = last.round + 1 >= snap.tournament.rounds ? "the final" : "round " + (last.round + 1);
        return { mode: "bye", near: me, rivals: sameRound.join(" or "), rivalList: nameList(sameRound), round: last.round, nextLabel };
      }
      if (isSE() && sameRound.length) {
        return { mode: "waitdraw", near: me, last, won: last.winner === youId(), waiting: nameList(sameRound), nextRound: last.round + 1 };
      }
      return { mode: "none", near: me };
    }
    // not in the tournament: no field of your own, the round is a grid of tables
    return { mode: "grid" };
  }

  /* ---------- seats, decks, halves ---------- */
  function seat(p, side, o) {
    o = o || {};
    if (!p) {
      return `<div class="seat ${side} empty"><span class="mono dashed" aria-hidden="true"></span><div class="seat-t">${o.text ? `<b class="nm">${esc(o.text)}</b>` : ""}${o.sub ? `<span class="rec">${esc(o.sub)}</span>` : ""}</div></div>`;
    }
    return `<div class="seat ${side}${o.champ ? " champ" : ""}${p.you ? " you" : ""}" data-pid="${p.id}">
      ${mono(p, "big")}
      <div class="seat-t">
        <span class="nmrow"><b class="nm">${esc(p.name)}</b>${p.you ? '<span class="you-pill">You</span>' : ""}</span>
        ${tierLine(p)}
        ${o.noRec ? "" : `<span class="rec">${recOf(p.id)} tonight</span>`}
      </div></div>`;
  }
  function deckZone(p) {
    const none = p.deck === "none";
    const stack = none ? '<span class="dbox none"></span>' : '<span class="dbox"><i></i><i></i><i></i></span>';
    const link = none && p.you ? '<a class="choose" href="#decks">Choose a deck</a>' : "";
    return `<div class="dz${none ? " none" : ""}">${stack}<span class="dl">${none ? "No deck yet" : "Deck in"}</span>${link}</div>`;
  }
  function litHalf(side, p, colour, cur) {
    return `<div class="half ${side} lit" style="--hc:${colour}">${deckZone(p)}<div class="zrow">${zoneRow(p.id, { cur })}</div></div>`;
  }
  function darkHalf(side, kind, msg, extra) {
    return `<div class="half ${side} ${kind}"><p class="hmsg">${esc(msg || "")}</p>${extra || ""}</div>`;
  }
  const colourOf = (p) => (p.you ? BEAM : p.ring);

  /* ---------- the centre of the field ---------- */
  function marks(m, firstId) {
    const firstIsP1 = m.p1 === firstId;
    const aW = firstIsP1 ? m.games[0] : m.games[1];
    const bW = firstIsP1 ? m.games[1] : m.games[0];
    const aP = pl(firstId), bP = pl(firstIsP1 ? m.p2 : m.p1);
    const aC = aP.you ? "var(--pen)" : aP.ring;
    const out = [];
    for (let i = 0; i < aW; i++) out.push(`<i class="mk on" style="--c:${aC}"></i>`);
    for (let i = 0; i < bW; i++) out.push(`<i class="mk on" style="--c:${bP.ring}"></i>`);
    while (out.length < snap.tournament.bestOf) out.push('<i class="mk"></i>');
    return `<span class="marks" role="img" aria-label="Best of ${snap.tournament.bestOf}, ${aW} to ${bW}">${out.join("")}</span>`;
  }

  function matchCentre(h) {
    const m = h.m;
    // the first number is yours
    const firstId = h.near.id;
    const secondId = h.far.id;
    const sc = (id) => (m.p1 === id ? m.games[0] : m.games[1]);
    const reported = m.status === "reported";
    const isLast = m.round === snap.tournament.rounds && isSE();
    const rl = isLast ? "Final" : "Round " + m.round;
    let stat;
    if (m.status === "live") stat = `Game ${m.game} in progress`;
    else if (m.status === "between") stat = `Between games. Game ${m.game} next.`;
    else stat = `${rl}. Not started.`;
    let reportLine = "";
    if (reported) {
      const rep = pl(m.reporter);
      const score = hiLo(m.games);
      if (isYou(m.reporter)) reportLine = `You reported by hand that ${isYou(m.winner) ? "you" : "they"} won ${score}.`;
      else reportLine = `${esc(rep.name)} reported by hand that ${m.winner === m.reporter ? "they" : isYou(m.winner) ? "you" : "they"} won ${score}.`;
    }
    const score = `<div class="score" aria-label="Series score ${sc(firstId)} to ${sc(secondId)}">${dg(`h:${m.id}:${firstId}`, sc(firstId))}<span class="dash"> – </span>${dg(`h:${m.id}:${secondId}`, sc(secondId))}</div>`;
    if (reported) {
      return `<div class="centre reported" data-mid="${m.id}"><div class="gframe">${score}<p class="rline-t">${reportLine}</p></div></div>`;
    }
    return `<div class="centre" data-mid="${m.id}">${score}${marks(m, firstId)}<p class="cstat">${stat}</p></div>`;
  }

  function stakesBlock(h) {
    const m = h.m;
    const s = TD.stakes(h.near, h.far);
    if (m.status === "reported" && !isYou(m.reporter)) {
      const won = isYou(m.winner);
      return `<p class="stakes"><span class="${won ? "up" : "dn"}"><b>${fmtDelta(won ? s.win : s.lose)}</b> if you confirm</span></p>`;
    }
    if (m.status === "reported") return "";
    return `<p class="stakes"><span class="up"><b>${fmtDelta(s.win)}</b> if you win</span><span class="dn"><b>${fmtDelta(s.lose)}</b> if you lose</span></p>`;
  }

  function finishLine() {
    if (!youId()) return "";
    const me = pl(youId());
    if (isSE()) {
      const mine = snap.matches.filter((m) => m.p1 === me.id || m.p2 === me.id).sort((a, b) => b.round - a.round)[0];
      if (mine && mine.round === snap.tournament.rounds && mine.winner !== me.id) return "You were the runner-up.";
      return "Your tournament is over.";
    }
    const r = stand().find((x) => x.player.id === me.id);
    const ord = (n) => n + (["th", "st", "nd", "rd"][(n % 100 > 10 && n % 100 < 14) ? 0 : n % 10 < 4 ? n % 10 : 0]);
    return `You finished ${ord(r.rank)} with ${r.wins}–${r.losses}.`;
  }

  /* ---------- the tables: every match in the round ---------- */
  const realIn = (round) => snap.matches.filter((m) => m.round === round && m.p2 && m.status !== "bye").sort((a, b) => a.id - b.id);
  const tableNo = (m) => realIn(m.round).findIndex((x) => x.id === m.id) + 1;
  function tableStatus(m) {
    if (m.status === "live") return `Game ${m.game} in progress`;
    if (m.status === "between") return `Between games. Game ${m.game} next.`;
    if (m.status === "reported") return `Reported by ${pl(m.reporter).name}. Waiting for ${isYou(other(m, m.reporter)) ? "you" : pl(other(m, m.reporter)).name}.`;
    if (m.status === "done") return "Final";
    return "Not started";
  }
  // size "sm": the small flat field (about 300x150). size "md": the medium one (about 420x210) with each player's rounds.
  function tableHTML(m, size) {
    const a = pl(m.p1), b = pl(m.p2);
    const md = size === "md";
    const done = m.status === "done";
    const half = (p, pos, gi) => {
      const won = done && m.winner === p.id;
      const slots = md ? `<span class="tslots" role="group" aria-label="Rounds for ${esc(p.name)}">${zoneRow(p.id, { strip: true, cur: m.round, compact: true })}</span>` : "";
      return `<div class="th ${pos}" style="--hc:${p.ring}">${mono(p, md ? "tm" : "ts")}<span class="tn"><b>${esc(p.name)}</b>${won ? ICON.star : ""}</span>${slots}</div>`;
    };
    const wc = (id) => (done && m.winner === id ? "win" : "");
    const score = `<span class="tscore" aria-label="Series score ${m.games[0]} to ${m.games[1]}">${dg(`t:${m.id}:${a.id}`, m.games[0], wc(a.id))}<span class="dash"> – </span>${dg(`t:${m.id}:${b.id}`, m.games[1], wc(b.id))}</span>`;
    const live = m.status === "live";
    const leaving = ro.leave === m.id && !live;
    const watch = live ? `<button class="watch" type="button" data-act="watch" aria-label="Watch ${esc(a.name)} against ${esc(b.name)}">Watch</button>`
      : leaving ? '<button class="watch leaving" type="button" tabindex="-1" aria-hidden="true">Watch</button>' : "";
    const stat = tableStatus(m);
    return `<article class="tbl ${size}" data-mid="${m.id}" data-st="${m.status}" aria-label="Table ${tableNo(m)}: ${esc(a.name)} and ${esc(b.name)}. ${esc(stat)}">
      <p class="tnum">Table ${tableNo(m)}</p>
      <div class="tfield">
        ${half(a, "top", 0)}
        <div class="tmid">${score}${marks(m, a.id)}</div>
        ${half(b, "bot", 1)}
      </div>
      <div class="tfoot"><p class="tstat${live ? " live" : ""}">${live ? '<i class="ldot" aria-hidden="true"></i>' : ""}${esc(stat)}</p>${watch}</div>
    </article>`;
  }
  function byeNote(round, skipId) {
    const names = snap.matches.filter((m) => m.round === round && m.status === "bye" && m.p1 !== skipId).map((m) => pl(m.p1).name);
    return names.length ? `<p class="byeinfo">Bye this round: ${esc(nameList(names))}.</p>` : "";
  }
  // Compact strip card for the row at the top: one line (player, score, player) and one status line.
  // Your own table comes first, with a pen edge and no Watch; clicking it scrolls to your field.
  function stripHTML(m) {
    const me = youId();
    const mine = !!me && (m.p1 === me || m.p2 === me);
    const flip = mine && m.p2 === me;
    const L = pl(flip ? m.p2 : m.p1), R = pl(flip ? m.p1 : m.p2);
    const gi = (p) => (m.p1 === p.id ? 0 : 1);
    const done = m.status === "done";
    const wc = (p) => (done && m.winner === p.id ? "win" : "");
    const live = m.status === "live";
    const leaving = ro.leave === m.id && !live && !mine;
    const stat = tableStatus(m);
    const watch = live && !mine ? `<button class="watch" type="button" data-act="watch" aria-label="Watch ${esc(L.name)} against ${esc(R.name)}">Watch</button>`
      : leaving ? '<button class="watch leaving" type="button" tabindex="-1" aria-hidden="true">Watch</button>' : "";
    const lbl = `${mine ? "Your table" : "Table " + tableNo(m)}: ${L.name} and ${R.name}. ${stat}`;
    const inner = `<div class="tcl">
        <span class="tp l">${mono(L, "tx")}<b>${esc(L.name)}</b></span>
        <span class="tcs"><span class="tscore" aria-label="Series score ${m.games[gi(L)]} to ${m.games[gi(R)]}">${dg(`t:${m.id}:${L.id}`, m.games[gi(L)], wc(L))}<span class="dash"> – </span>${dg(`t:${m.id}:${R.id}`, m.games[gi(R)], wc(R))}</span>${marks(m, L.id)}</span>
        <span class="tp r"><b>${esc(R.name)}</b>${mono(R, "tx")}</span>
      </div>
      <div class="tcf"><p class="tstat${live ? " live" : ""}">${mine ? '<span class="ytag">Your table</span>' : ""}${live ? '<i class="ldot" aria-hidden="true"></i>' : ""}${esc(stat)}</p>${watch}</div>`;
    const attrs = `class="tc${mine ? " mine" : ""}" data-mid="${m.id}" data-st="${m.status}" style="--ca:${L.you ? "var(--pen)" : L.ring};--cb:${R.ring}"`;
    return mine ? `<a ${attrs} href="#field" data-act="gofield" aria-label="${esc(lbl)}. Go to your field">${inner}</a>`
      : `<article ${attrs} aria-label="${esc(lbl)}">${inner}</article>`;
  }
  // The row at the very top (players only): every match in the round, yours first.
  function tablesRowHTML(round) {
    if (round === null) return "";
    const me = youId();
    const list = realIn(round).sort((a, b) => (me && (b.p1 === me || b.p2 === me) ? 1 : 0) - (me && (a.p1 === me || a.p2 === me) ? 1 : 0) || a.id - b.id);
    const bye = byeNote(round, me);
    if (!list.length && !bye) return "";
    const rn = isSE() && round === snap.tournament.rounds ? "The final" : roundName(round);
    return `<section class="tables" aria-labelledby="tb-h"><h2 id="tb-h" class="tb-h">${rn}. ${list.length} table${list.length === 1 ? "" : "s"}.</h2>
      ${list.length ? `<div class="tgrid strips">${list.map(stripHTML).join("")}</div>` : ""}${bye}</section>`;
  }
  // Not in the tournament: no field, the whole round as an equal grid of medium fields.
  function gridHTML(round) {
    const T = snap.tournament;
    const head = isSE() && round === T.rounds ? "The final. Every table." : `Round ${round} of ${T.rounds}. Every table.`;
    const list = realIn(round);
    return `<section class="hero is-grid" aria-labelledby="gh" data-mode="grid"><h2 id="gh" class="gh">${head}</h2>
      <div class="tgrid md">${list.map((m) => tableHTML(m, "md")).join("")}</div>${byeNote(round, 0)}</section>`;
  }

  function heroHTML() {
    const h = heroModel();
    heroMid = h.mode === "match" ? h.m.id : 0;
    const keep = hold !== null && h.mode !== "lobby" && h.mode !== "champ";
    if (h.mode === "grid") return gridHTML(keep ? hold : currentRound());
    let farSeat = "", nearSeat = "", farHalf = "", nearHalf = "", centre = "", stakes = "", actions = "", offsite = "", after = "", cls = "";
    let label = "The duel field";
    let tround = null;
    let cur = 0;
    if (h.mode === "match") {
      const m = h.m;
      cur = tround = m.round;
      centre = matchCentre(h);
      farSeat = seat(h.far, "far");
      nearSeat = seat(h.near, "near");
      farHalf = litHalf("far", h.far, colourOf(h.far), cur);
      nearHalf = litHalf("near", h.near, colourOf(h.near), cur);
      label = "Your next duel";
      stakes = stakesBlock(h);
      if (m.status === "reported" && !isYou(m.reporter)) {
        cls = " is-confirm";
        actions = `<button class="btn primary big" type="button" data-act="confirm">Confirm</button><button class="btn ghost big" type="button" data-act="deny">Deny</button>`;
        after = `<p class="autoc">Confirms itself in ${hoursWord(m.confirmHoursLeft)} if you do nothing.</p>`;
      } else if (m.status === "reported") {
        after = `<p class="autoc">${esc(pl(confirmer(m)).name)} has ${hoursWord(m.confirmHoursLeft)} to confirm.</p>`;
      } else {
        // the actions follow the duel: not started, a game in progress, or between games
        const started = m.status === "live" || m.status === "between";
        actions = `<button class="btn primary big" type="button" data-act="start">${started ? "Open duel" : "Start duel"}</button>`;
        offsite = `<p class="offsite">Played off the site? <a href="#report" data-act="report">Report a result</a></p>`;
      }
    } else if (h.mode === "lobby") {
      const me = youId() ? pl(youId()) : null;
      cls = " is-lobby";
      farSeat = seat(null, "far", { text: "Your first opponent" });
      farHalf = darkHalf("far", "dashed", "Your first opponent is drawn when the host starts.");
      centre = `<div class="centre idle"><p class="cstat">The tournament has not started.</p></div>`;
      if (me) {
        nearSeat = seat(me, "near", { noRec: true });
        nearHalf = litHalf("near", me, BEAM);
        after = `<p class="deckline">Your draft deck is used. <span class="dstat ${me.deck === "none" ? "no" : "in"}">${me.deck === "none" ? "No deck yet" : "Deck in"}</span></p>`;
      } else {
        nearSeat = seat(null, "near", { text: "Your seat" });
        nearHalf = darkHalf("near", "dashed", "Join to take this side of the field.");
        actions = `<button class="btn primary big" type="button" data-act="join">Join the tournament</button>`;
        after = `<p class="deckline">Your draft deck is used when you join.</p>`;
      }
    } else if (h.mode === "bye") {
      tround = h.round; cur = h.round;
      farSeat = seat(null, "far", { text: h.rivals });
      farHalf = darkHalf("far", "dashed", `${h.rivalList} play ${roundName(h.round).toLowerCase()}.`);
      nearSeat = seat(h.near, "near");
      nearHalf = litHalf("near", h.near, BEAM, cur);
      centre = `<div class="centre idle"><p class="byeline"><b>Bye this round.</b> You go straight to ${h.nextLabel}.</p></div>`;
    } else if (h.mode === "waitdraw") {
      tround = h.last.round; cur = h.last.round;
      const o = pl(other(h.last, youId()));
      farSeat = seat(null, "far", { text: "Next opponent not drawn yet" });
      farHalf = darkHalf("far", "dashed", "Not drawn yet.");
      nearSeat = seat(h.near, "near");
      nearHalf = litHalf("near", h.near, BEAM, cur);
      centre = `<div class="centre idle"><p class="byeline">${h.won ? `<b>You beat ${esc(o.name)} ${hiLo(h.last.games)}.</b>` : `<b>${esc(o.name)} beat you ${hiLo(h.last.games)}.</b>`} Your next opponent is drawn when round 1 ends.</p></div>`;
    } else if (h.mode === "none") {
      tround = cur = currentRound();
      farSeat = seat(null, "far", { text: "No duel right now" });
      farHalf = darkHalf("far", "dashed", "Nothing is waiting for you.");
      nearSeat = seat(h.near, "near");
      nearHalf = litHalf("near", h.near, BEAM, cur);
      centre = `<div class="centre idle"><p class="byeline">You have no duel to play right now.</p></div>`;
    } else if (h.mode === "champ") {
      const c = h.champ;
      const r = stand().find((x) => x.player.id === c.id);
      cls = " is-done";
      label = "The champion's field";
      farSeat = seat(c, "far", { champ: true });
      farHalf = litHalf("far", c, "var(--chain)");
      const fl = finishLine();
      nearHalf = `<div class="half near unlit"><a class="back-link" href="#draft">Back to the draft</a>${fl ? `<p class="hmsg">${esc(fl)}</p>` : ""}</div>`;
      centre = `<div class="centre champ-c"><h2 class="ctitle">${esc(c.name)} wins ${esc(snap.tournament.name)}</h2><p class="crec">${r.wins}–${r.losses}</p></div>`;
    }
    if (keep && tround !== null) tround = hold;
    return `${tablesRowHTML(tround)}<section class="hero${cls}" id="field" aria-label="${label}" data-mode="${h.mode}">
      <div class="seatrow far">${farSeat}</div>
      <div class="stage"><div class="field" role="group" aria-label="${label}">
        ${farHalf}
        <div class="mid">${centre}</div>
        ${nearHalf}
      </div></div>
      <div class="nearbox">
        <div class="seatrow near">${nearSeat}</div>
        ${stakes}${after}
        ${actions ? `<div class="actions"><div class="abtns">${actions}</div>${offsite}</div>` : ""}
      </div>
    </section>`;
  }

  // The round whose tables are on screen now (used to hold the round while a result plays out).
  function tablesRound() {
    const h = heroModel();
    if (h.mode === "grid") return currentRound();
    if (h.mode === "match") return h.m.round;
    if (h.mode === "bye") return h.round;
    if (h.mode === "waitdraw") return h.last.round;
    if (h.mode === "none") return currentRound();
    return null;
  }

  /* ---------- lobby extras ---------- */
  function lobbyHTML() {
    const n = snap.players.length, cap = Math.max(TD.PLAYERS.length, n);
    const rows = snap.players.map((p) => `<li class="prow${p.you ? " you" : ""}">${mono(p)}<span class="pn"><b>${esc(p.name)}</b>${p.you ? '<span class="you-pill">You</span>' : ""}</span>${tierLine(p)}<span class="dstat ${p.deck === "none" ? "no" : "in"}">${p.deck === "none" ? "No deck yet" : "Deck in"}</span>${p.you ? '<button class="btn quiet" type="button" data-act="leave">Leave</button>' : '<span class="pgap"></span>'}</li>`).join("");
    const host = S.host ? `<div class="hostrow" role="group" aria-label="Host tools">
        <div class="hr-btns">
          <button class="btn primary" type="button" data-act="start-t"${n < 2 ? " disabled" : ""}>Start the tournament</button>
          <button class="btn ghost" type="button" data-act="add-bot">Add a bot</button>
          <button class="btn ghost" type="button" data-act="announce">Announce in Discord</button>
          <button class="btn danger" type="button" data-act="cancel">Cancel the tournament</button>
        </div>
        <p class="hr-note">${n < 2 ? "Starting needs 2 or more players." : "Starting draws the first round."} Cancelling removes the tournament for everyone.</p>
      </div>` : "";
    return `${host}
      <section class="sec" aria-labelledby="who-h">
        <h2 id="who-h" class="sec-h">Who's in <span class="cnt">(${n} of ${cap} joined)</span></h2>
        <ul class="plist" role="list">${rows}</ul>
      </section>
      <section class="sec invite" aria-labelledby="inv-h">
        <h2 id="inv-h" class="sec-h">Invite link</h2>
        <div class="inv-row"><input class="inv" type="text" readonly value="${esc(snap.tournament.inviteLink)}" aria-label="Invite link"><button class="btn ghost" type="button" data-act="copy">Copy link</button></div>
        <p class="note">Players can also join from Discord with /tournament join.</p>
      </section>`;
  }

  /* ---------- standings with locator strips (round robin) ---------- */
  function standingsHTML() {
    const rows = stand().map((r) => {
      const p = r.player;
      return `<li class="srow${p.you ? " you" : ""}${r.rank === 1 && snap.tournament.status === "completed" ? " first" : ""}" data-pid="${p.id}">
        <span class="rk">${r.rank}</span>
        ${mono(p, "md")}
        <span class="nm2"><b>${esc(p.name)}</b>${p.you ? '<span class="you-pill">You</span>' : ""}</span>
        <span class="ti">${tierLine(p)}</span>
        <span class="strip" role="group" aria-label="Rounds for ${esc(p.name)}">${zoneRow(p.id, { strip: true })}</span>
        <span class="recd" aria-label="${r.wins} wins, ${r.losses} losses">${r.wins}–${r.losses}</span>
      </li>`;
    }).join("");
    const done = snap.tournament.status === "completed";
    return `<section class="sec stand" aria-labelledby="st-h">
      <h2 id="st-h" class="sec-h">${done ? "Final standings" : "Standings"}</h2>
      <ol class="sl" role="list">${rows}</ol>
    </section>`;
  }

  /* ---------- your road (single elimination) ---------- */
  function roadHTML() {
    const T = snap.tournament.rounds;
    const mineMax = snap.matches.filter((m) => youId() && (m.p1 === youId() || m.p2 === youId())).reduce((a, m) => Math.max(a, m.round), 0);
    const reach = mineMax ? mineMax - 1 : -1;
    const stops = [];
    for (let r = 1; r <= T; r++) {
      const ms = snap.matches.filter((m) => m.round === r);
      let body = "";
      if (!ms.length) {
        let msg = "";
        if (r > 1) {
          const prev = snap.matches.filter((m) => m.round === r - 1);
          const un = prev.filter((m) => m.status !== "done" && m.status !== "bye");
          if (prev.length && un.length) msg = `${roundName(r)} is drawn when ${nameList(un.flatMap((m) => [pl(m.p1).name, pl(m.p2).name]))} finish.`;
          else msg = `${roundName(r)} comes after ${roundName(r - 1).toLowerCase()}.`;
        }
        body = `<p class="undrawn">${esc(msg)}</p>`;
      } else body = ms.map(chip).join("");
      stops.push(`<li class="stop${r - 1 <= reach ? " L" : ""}${r <= reach ? " R" : ""}" data-round="${r}">
        <span class="node"></span><h3 class="stop-h">${roundName(r)}</h3>${body}</li>`);
    }
    const done = snap.tournament.status === "completed";
    return `<section class="sec road-sec" aria-labelledby="road-h">
      <h2 id="road-h" class="sec-h">${done ? "The bracket" : youId() ? "Your road" : "The road"}</h2>
      <ol class="road" role="list">${stops.join("")}</ol>
    </section>`;
  }
  function chip(m) {
    if (m.status === "bye") {
      const p = pl(m.p1);
      return `<div class="chip bye${isYou(p.id) ? " mine" : ""}" data-mid="${m.id}"><div class="cs">${mono(p, "sm")}<span class="cn"><b>${esc(p.name)}</b>${p.you ? '<span class="you-pill">You</span>' : ""}</span><span class="byew">Bye</span></div></div>`;
    }
    const a = pl(m.p1), b = pl(m.p2);
    const mine = isYou(a.id) || isYou(b.id);
    const side = (p, o) => {
      const won = m.status === "done" && m.winner === p.id;
      const lost = m.status === "done" && m.winner !== p.id;
      const pend = m.status === "reported" && m.winner === p.id;
      const z = won || pend ? zone({ r: m.round, kind: won ? "win" : "pwin", m, opp: o, pid: p.id }, { mini: true }) : "";
      const score = m.games[m.p1 === p.id ? 0 : 1];
      return `<div class="cs${lost ? " lost" : ""}${won ? " won" : ""}">${mono(p, "sm")}<span class="cn"><b>${esc(p.name)}</b>${p.you ? '<span class="you-pill">You</span>' : ""}</span>${z}<span class="csc">${m.status === "open" ? "" : dg(`c:${m.id}:${p.id}`, score)}</span></div>`;
    };
    const note = m.status === "live" ? `Game ${m.game} in progress` : m.status === "between" ? `Game ${m.game} next` : m.status === "reported" ? "Waiting to confirm" : m.status === "open" ? "Not started" : "";
    return `<div class="chip${mine ? " mine" : ""}" data-mid="${m.id}">${side(a, b)}${side(b, a)}${note ? `<span class="cnote">${note}</span>` : ""}</div>`;
  }

  /* ---------- Tonight rail ---------- */
  function railHTML(opts) {
    opts = opts || {};
    const st = snap.tournament.status;
    const t = snap.tournament;
    let out = "";
    if (st === "active") {
      const rep = realMatches().filter((m) => m.status === "reported");
      if (rep.length) {
        const li = rep.map((m) => {
          const r = m.reporter, o = other(m, r);
          const verb = m.winner === r ? "beating" : "losing to";
          const text = `${isYou(r) ? "You" : esc(pl(r).name)} reported ${verb} ${isYou(o) ? "you" : esc(pl(o).name)} ${hiLo(m.games)}. ${isYou(o) ? "You have" : esc(pl(o).name) + " has"} ${hoursWord(m.confirmHoursLeft)} to confirm.`;
          return `<li class="rwait" data-mid="${m.id}">${text}</li>`;
        }).join("");
        out += `<section class="rsec" aria-labelledby="r-wait"><h2 id="r-wait">Waiting to confirm</h2><ul role="list" class="rlist">${li}</ul></section>`;
      }
    }
    if (st !== "pending") {
      const fl = feed().map((f) => `<li class="rfeed${f.matchId && f.matchId === opts.newMid ? " new" : ""}" data-mid="${f.matchId}"><time>${f.at}</time><span>${esc(f.text)}</span></li>`).join("");
      out += `<section class="rsec" aria-labelledby="r-res"><h2 id="r-res">Results</h2><ul role="list" class="rlist feed">${fl}</ul></section>`;
    }
    const rules = t.rules.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("");
    out += `<section class="rsec" aria-labelledby="r-rules"><h2 id="r-rules">Rules</h2><dl class="rules">${rules}</dl><a class="fromdraft" href="#draft">Made from the draft ${esc(t.fromDraft)}</a></section>`;
    return out;
  }

  /* ---------- top bar, drawer, popovers ---------- */
  function barHTML() {
    const t = snap.tournament;
    const st = t.status;
    const cr = currentRound();
    const where = st === "pending" ? `<span class="w"><b>${snap.players.length}</b><small>players in</small></span>`
      : st === "completed" ? `<span class="w fin"><b>Finished</b></span>`
        : isSE() && cr === t.rounds ? `<span class="w"><b>The final</b></span>`
          : `<span class="w"><small>Round</small><b>${cr}</b><small>of ${t.rounds}</small></span>`;
    const hostBtn = S.host && st === "active" ? `<button class="ibtn" type="button" data-act="drawer" aria-expanded="${drawerOpen}" aria-controls="drawer" aria-label="Host tools">${ICON.host}<span class="lbl">Host tools</span></button>` : "";
    return `<div class="id"><a class="back" href="#draft" aria-label="Back to the draft">${ICON.back}</a>
        <div class="room-name"><b>${esc(t.name)}</b><small>${esc(t.subtitle)}. ${esc(t.formatLabel)}, best of ${t.bestOf}.</small></div></div>
      <div class="where">${where}</div>
      <div class="right">${hostBtn}<button class="ibtn" type="button" data-act="pop" aria-expanded="${popOpen}" aria-controls="pop" aria-label="Animations">${ICON.motion}<span class="lbl">Animations</span></button></div>`;
  }
  function drawerHTML() {
    const rows = snap.players.map((p) => `<li class="drow">${mono(p, "sm")}<span class="pn">${esc(p.name)}</span><span class="dstat ${p.deck === "none" ? "no" : "in"}">${p.deck === "none" ? "No deck yet" : "Deck in"}</span></li>`).join("");
    return `<div class="dr-head"><h2>Host tools</h2><button class="x" type="button" data-act="drawer" aria-label="Close host tools">×</button></div>
      <section class="dr-sec"><h3>Decks</h3><ul class="dlist" role="list">${rows}</ul></section>
      <section class="dr-sec"><h3>End the tournament early</h3>
        <button class="btn danger wide" type="button" data-act="end">End now</button>
        <p class="note">Unplayed matches stay unplayed and no champion is recorded.</p></section>
      <section class="dr-sec"><h3>Remove it</h3>
        <button class="btn danger wide" type="button" data-act="cancel">Cancel the tournament</button>
        <p class="note">Removes the tournament for everyone, results and Elo included.</p></section>`;
  }
  function popHTML() {
    const m = motion();
    return `<h3>Animations</h3>
      <div class="seg" role="group" aria-label="Animations">${["full", "calm", "off"].map((l) => `<button type="button" data-motion="${l}" aria-pressed="${m === l}">${l[0].toUpperCase() + l.slice(1)}</button>`).join("")}</div>
      <p>Full plays the whole moment and the slow drift of light. Calm keeps it short with no looping light. Off keeps everything still.</p>`;
  }

  /* ---------- mock controls ---------- */
  function buildDemo() {
    const tab = document.createElement("button");
    tab.type = "button"; tab.className = "kit-demo-tab"; tab.textContent = "Mock controls";
    tab.setAttribute("aria-expanded", "false"); tab.id = "demo-tab";
    const panel = document.createElement("div");
    panel.className = "kit-demo"; panel.id = "demo"; panel.hidden = true;
    panel.setAttribute("role", "region"); panel.setAttribute("aria-label", "Mock controls");
    document.body.append(tab, panel);
    tab.addEventListener("click", () => { demoOpen = !demoOpen; panel.hidden = !demoOpen; tab.setAttribute("aria-expanded", String(demoOpen)); });
    panel.addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      if (b.classList.contains("kd-x")) { demoOpen = false; panel.hidden = true; tab.setAttribute("aria-expanded", "false"); return; }
      if (b.dataset.fmt) { S.format = b.dataset.fmt; reload(); }
      else if (b.dataset.st) { S.state = b.dataset.st; reload(); }
      else if (b.dataset.vw) { S.viewer = b.dataset.vw; reload(); }
      else if (b.dataset.host) { S.host = b.dataset.host === "on"; if (!S.host) drawerOpen = false; reload(true); }
      else if (b.id === "ev") comeIn();
      else if (b.id === "reset") reload();
    });
    renderDemo();
  }
  function renderDemo() {
    const panel = $("#demo"); if (!panel) return;
    const pr = (on) => `aria-pressed="${on}"`;
    panel.innerHTML = `<div class="kd-head"><b>Mock controls</b><button type="button" class="kd-x" aria-label="Close">×</button></div>
      <p class="kd-note">For trying the mock. Not part of the design.</p>
      <div class="kd-row"><span>Format</span><button type="button" data-fmt="round_robin" ${pr(S.format === "round_robin")}>Round robin</button><button type="button" data-fmt="single_elim" ${pr(S.format === "single_elim")}>Single elimination</button></div>
      <div class="kd-row"><span>State</span>${[["lobby", "Lobby"], ["live", "Live"], ["confirm", "Waiting on you"], ["done", "Finished"]].map(([k, l]) => `<button type="button" data-st="${k}" ${pr(S.state === k)}>${l}</button>`).join("")}</div>
      <div class="kd-row"><span>Viewer</span><button type="button" data-vw="player" ${pr(S.viewer === "player")}>Player (Imran)</button><button type="button" data-vw="spectator" ${pr(S.viewer === "spectator")}>Spectator</button></div>
      <div class="kd-row"><span>Host tools</span><button type="button" data-host="on" ${pr(S.host)}>On</button><button type="button" data-host="off" ${pr(!S.host)}>Off</button></div>
      <div class="kd-row"><span>Simulates the duel system sending a finished game.</span><button type="button" id="ev"${nextAvailable() ? "" : " disabled"}>A duel finishes</button><button type="button" id="reset">Reset</button></div>`;
  }
  function nextAvailable() { if (!snap) return false; const p = clone(snap); return !!TD.nextEvent(p); }

  /* ---------- render ---------- */
  function render(opts) {
    opts = opts || {};
    ro = opts;
    const st = snap.tournament.status;
    $("#bar").innerHTML = barHTML();
    let main = heroHTML();
    if (st === "pending") main += lobbyHTML();
    else main += isSE() ? roadHTML() : standingsHTML();
    $("#main").innerHTML = main;
    $("#rail").innerHTML = railHTML(opts);
    $("#drawer").innerHTML = drawerHTML();
    const hostOn = S.host && st === "active";
    $("#drawer").hidden = !hostOn;
    $("#drawer").classList.toggle("open", drawerOpen && hostOn);
    $("#pop").innerHTML = popHTML();
    $("#pop").hidden = !popOpen;
    document.body.dataset.state = st;
    document.body.dataset.actions = $(".actions") ? "1" : "0";
    renderDemo();
  }
  function commitScores() { $$(".dg").forEach((d) => { lastScores[d.dataset.k] = d.dataset.v; }); }

  function reload(keepScores) {
    snap = TD.snapshot(S.format, S.state, { viewer: S.viewer, host: S.host });
    if (!keepScores) lastScores = {};
    render();
    commitScores();
    try { history.replaceState(null, "", `?format=${S.format}&state=${S.state}&viewer=${S.viewer}&host=${S.host ? 1 : 0}${params.get("anim") ? "&anim=" + params.get("anim") : ""}`); } catch (e) { /* file urls may refuse */ }
  }

  /* ---------- toast and tooltip ---------- */
  let toastT = 0;
  function toast(msg) {
    const t = $("#toast"); t.textContent = msg; t.classList.add("on");
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("on"), 2000);
  }
  const tipEl = $("#tip");
  function showTip(el) {
    const text = el.getAttribute("data-tip");
    if (!text) return;
    tipEl.textContent = text; tipEl.hidden = false;
    const r = el.getBoundingClientRect(), w = tipEl.offsetWidth, h = tipEl.offsetHeight;
    let x = r.left + r.width / 2 - w / 2;
    x = Math.max(8, Math.min(innerWidth - w - 8, x));
    let y = r.top - h - 8;
    if (y < 8) y = r.bottom + 8;
    tipEl.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }
  const hideTip = () => { tipEl.hidden = true; };
  document.addEventListener("pointerover", (e) => { const el = e.target.closest("[data-tip]"); if (el) showTip(el); });
  document.addEventListener("pointerout", (e) => { if (e.target.closest("[data-tip]")) hideTip(); });
  document.addEventListener("focusin", (e) => { const el = e.target.closest && e.target.closest("[data-tip]"); if (el) showTip(el); });
  document.addEventListener("focusout", hideTip);
  window.addEventListener("scroll", hideTip, { passive: true });

  /* ---------- actions ---------- */
  function act(name) {
    const m = myMatch();
    switch (name) {
      case "start": if (m && m.status === "open") { m.status = "live"; m.game = 1; render(); commitScores(); const b = $('[data-act="start"]'); if (b) b.focus(); } else toast("In the app this opens your duel room."); break;
      case "report": toast("In the app this opens the report form."); break;
      case "gofield": { const f = $(".hero"); if (f) f.scrollIntoView({ block: "start" }); break; }
      case "watch": toast("Opens the duel to watch."); break;
      case "confirm": if (m) { m.status = "done"; m.at = "10:05 PM"; m.reporter = null; m.confirmHoursLeft = null; render(); commitScores(); toast("Result confirmed."); } break;
      case "deny": if (m) { const rep = pl(m.reporter).name; m.status = "open"; m.games = [0, 0]; m.winner = null; m.reporter = null; m.confirmHoursLeft = null; render(); commitScores(); toast(`Result denied. ${rep} can report again.`); } break;
      case "join": snap.players.push({ id: 99, name: "You", mono: "Yo", ring: "#9b7eff", tier: "Silver", elo: 1000, deck: "none", you: true, joined: true }); snap.youId = 99; snap.viewer = "player"; render(); break;
      case "leave": snap.players = snap.players.filter((p) => !p.you); snap.youId = null; snap.viewer = "spectator"; render(); break;
      case "start-t": S.state = "live"; reload(); break;
      case "add-bot": { const n = snap.players.filter((p) => /^Bot/.test(p.name)).length + 1; snap.players.push({ id: 100 + n, name: `Bot ${n}`, mono: "Bo", ring: "#8a93a6", tier: "Silver", elo: 1000, deck: "in", joined: true }); render(); break; }
      case "announce": toast("Announced in the Discord channel."); break;
      case "end": toast("In the app this ends the tournament now."); break;
      case "cancel": toast("In the app this cancels the tournament for everyone."); break;
      case "copy": { const v = snap.tournament.inviteLink; try { navigator.clipboard.writeText(v); } catch (e) { /* ignore */ } toast("Link copied."); break; }
      case "drawer": setDrawer(!drawerOpen); break;
      case "pop": setPop(!popOpen); break;
    }
  }
  function setDrawer(on) {
    drawerOpen = on;
    $("#drawer").classList.toggle("open", on);
    $$('[data-act="drawer"]').forEach((b) => b.setAttribute("aria-expanded", String(on)));
    if (on) setTimeout(() => { const x = $("#drawer .x"); if (x) x.focus(); }, 30);
    else { const b = $('#bar [data-act="drawer"]'); if (b) b.focus(); }
  }
  function setPop(on) {
    popOpen = on;
    const pop = $("#pop"); pop.hidden = !on;
    $$('[data-act="pop"]').forEach((b) => b.setAttribute("aria-expanded", String(on)));
    if (on) {
      const b = $('#bar [data-act="pop"]').getBoundingClientRect();
      pop.style.top = b.bottom + 8 + "px";
      pop.style.right = Math.max(10, innerWidth - b.right) + "px";
    }
  }
  document.addEventListener("click", (e) => {
    const a = e.target.closest("[data-act]");
    if (a) { e.preventDefault(); act(a.dataset.act); return; }
    const mb = e.target.closest("#pop [data-motion]");
    if (mb) { setMotion(mb.dataset.motion, true); $("#pop").innerHTML = popHTML(); return; }
    if (popOpen && !e.target.closest("#pop")) setPop(false);
    const link = e.target.closest("a[href^='#']");
    if (link && link.getAttribute("href") !== "#main") e.preventDefault();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { if (popOpen) { setPop(false); const b = $('#bar [data-act="pop"]'); if (b) b.focus(); } else if (drawerOpen) setDrawer(false); }
  });

  /* ================================================================
     THE MOMENT: a locator card is projected and claimed. It starts when the duel system sends a finished game.
     final:     the table's score rolls, a gold locator card resolves from a thin line of light at that table
                (or in the centre of the field if the match is yours), flies in an arc into the winner's slot in
                the standings (or your zone on the field), the loser's slot fills with a dim card back, the rows
                slide to their new ranks (FLIP), the results feed gains a line, the table reads "Final" and its
                Watch button fades out.
     confirmed: the half-transparent card fills in and its clock fades.
     game:      that table's score rolls and its status reads "Between games".
     Calm: no resolve and no flight, the card fades into its slot, rows slide. Off: instant.
     The round's tables stay on screen until the moment ends (hold), so a single-elimination round that draws the
     next round does not swap the table away mid-flight.
     ================================================================ */
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const center = (r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
  const inView = (r) => r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
  const EASE = "cubic-bezier(0.16, 1, 0.3, 1)";

  // Scroll just enough to have both the source and the target on screen (the standings sit below the tables).
  function frame(a, b) {
    const pad = 22;
    const barH = document.body.dataset.actions === "1" && innerWidth <= 760 ? 128 : 0;
    const vh = innerHeight - barH;
    const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    const top = Math.min(ra.top, rb.top), bottom = Math.max(ra.bottom, rb.bottom);
    let d = 0;
    if (bottom - top <= vh - 2 * pad) {
      if (top < pad) d = top - pad; else if (bottom > vh - pad) d = bottom - (vh - pad);
    } else {
      // too far apart for one screen: show the table first, and the flight carries the page down to the target
      if (Math.abs(ra.top - pad) > 1) window.scrollBy(0, ra.top - pad);
      const rb2 = b.getBoundingClientRect();
      const want = rb2.top + rb2.height / 2 - vh / 2;
      const room = document.documentElement.scrollHeight - innerHeight - scrollY;
      return Math.max(0, Math.min(want, room));
    }
    if (Math.abs(d) > 1) window.scrollBy(0, d);
    return 0;
  }

  function rollAll(ms) {
    $$(".dg[data-from]").forEach((d) => {
      const from = d.dataset.from, to = d.dataset.v;
      const inner = d.firstElementChild;
      delete d.dataset.from;
      if (motion() === "off" || ms <= 0) return;
      d.classList.add("rolling");
      inner.innerHTML = `<b>${from}</b><b>${to}</b>`;
      const an = inner.animate([{ transform: "translateY(0)" }, { transform: "translateY(-50%)" }], { duration: ms, easing: EASE, fill: "forwards" });
      an.finished.then(() => { inner.innerHTML = `<b>${to}</b>`; an.cancel(); d.classList.remove("rolling"); }).catch(() => {});
    });
  }

  async function comeIn() {
    if (busy) return;
    const probe = clone(snap);
    const ev = TD.nextEvent(probe);
    if (!ev) return;
    busy = true;
    hold = motion() === "off" ? null : tablesRound();
    try { await playEvent(ev); } finally {
      const swap = hold !== null && hold !== tablesRound();
      if (swap) {
        await wait(motion() === "full" ? 1100 : 600);
        hold = null; render({}); commitScores();
      }
      hold = null; busy = false; renderDemo();
    }
  }

  async function playEvent(ev) {
    const mo = motion();
    const full = mo === "full", calm = mo === "calm";
    const m0 = snap.matches.find((x) => x.id === ev.matchId);
    const mine = !!(m0 && youId() && (m0.p1 === youId() || m0.p2 === youId()));
    const winnerId = ev.kind === "final" ? (ev.games[0] > ev.games[1] ? m0.p1 : m0.p2) : ev.kind === "confirmed" ? m0.winner : null;
    const wasLive = m0.status === "live";
    // FIRST: where every row is now
    const first = {};
    $$(".srow").forEach((r) => { first[r.dataset.pid] = r.getBoundingClientRect().top + scrollY; });
    TD.nextEvent(snap);
    render(mo === "off" ? {} : { newMid: ev.kind === "game" ? 0 : ev.matchId, leave: wasLive ? ev.matchId : null });
    rollAll(full ? 520 : calm ? 220 : 0);
    commitScores();
    if (mo === "off") return;
    // the table's Watch button fades out (the duel is no longer in progress)
    $$(".watch.leaving").forEach((b) => b.animate([{ opacity: 1 }, { opacity: 0 }], { duration: full ? 420 : 200, fill: "forwards" }).finished.then(() => b.remove()).catch(() => {}));

    // FLIP: invert any standings row that moved
    const moved = [];
    $$(".srow").forEach((r) => {
      const was = first[r.dataset.pid];
      if (was === undefined) return;
      const dy = was - (r.getBoundingClientRect().top + scrollY);
      if (Math.abs(dy) > 1) moved.push({ r, dy });
    });
    moved.forEach((x) => { x.r.style.transform = `translateY(${x.dy}px)`; });
    const feedLi = $(".rfeed.new");
    if (feedLi) feedLi.style.opacity = "0";
    const flipIn = (ms) => moved.forEach((x) => {
      const an = x.r.animate([{ transform: `translateY(${x.dy}px)` }, { transform: "translateY(0)" }], { duration: ms, easing: EASE });
      x.r.style.transform = ""; an.finished.catch(() => {});
    });
    const feedIn = (ms) => { if (feedLi) { feedLi.style.opacity = ""; feedLi.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ms, easing: "ease-out" }); } };
    const fade = (els, ms, delay) => els.forEach((el) => el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ms, delay: delay || 0, easing: "ease-out", fill: "backwards" }));

    if (ev.kind === "final") {
      const slots = $$(`[data-slot$=":${ev.matchId}"]`);
      const cards = slots.map((s) => $(".zc", s) || s);
      // the card is claimed by the winner's slot: your zone on the field if the match is yours, else the standings strip or the road
      const wslots = $$(`[data-slot="${winnerId}:${ev.matchId}"]`);
      const prim = (mine ? wslots.find((s) => s.closest(".field")) : wslots.find((s) => s.closest(".strip, .chip"))) || wslots[0];
      const target = prim && ($(".zc", prim) || prim);
      const srcEl = $(`.tc[data-mid="${ev.matchId}"] .tscore, .tbl[data-mid="${ev.matchId}"] .tscore`) || (mine ? $(".hero .centre") : null);
      if (!full || !target || !srcEl) { fade(cards, calm ? 280 : 200); flipIn(260); feedIn(200); await wait(300); return; }
      // bring the table and its landing slot on screen together, then measure
      const later = frame(srcEl, prim);
      cards.forEach((c) => { c.style.opacity = "0"; });
      const tr = target.getBoundingClientRect();
      const from = center(srcEl.getBoundingClientRect());
      const to = center(tr);
      to.y -= later;
      const onField = !!prim.closest(".field") && matchMedia("(min-width: 761px)").matches;
      const W = Math.max(36, tr.width), H = W * 86 / 59;
      const endS = tr.width / W;
      const g = document.createElement("span");
      g.className = "fly";
      g.style.width = W + "px"; g.style.height = H + "px"; g.style.setProperty("--w", W + "px");
      g.innerHTML = `${ICON.star}<b>${esc(pl(other(m0, winnerId)).mono)}</b>`;
      $("#fx").append(g);
      const T = (c, sx, sy, rx) => `translate(${c.x - W / 2}px, ${c.y - H / 2}px) perspective(1700px) rotateX(${rx}deg) scale(${sx}, ${sy})`;
      const rxEnd = onField ? 34 : 0;
      g.style.opacity = "0"; g.style.transform = T(from, 1, 0.02, 0);
      await wait(360);
      // resolve: a thin bright line of light opens to a full card
      await g.animate([{ transform: T(from, 1, 0.02, 0), opacity: 1 }, { transform: T(from, 1, 1, 0), opacity: 1 }], { duration: 250, easing: "cubic-bezier(0.2, 0.7, 0.2, 1)", fill: "forwards" }).finished;
      const mid = { x: (from.x + to.x) / 2, y: Math.min(from.y, to.y) - 80 };
      if (later > 1) {
        const y0 = scrollY, t0 = performance.now();
        const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
        const step = (now) => { const t = Math.min(1, (now - t0) / 700); window.scrollTo(0, y0 + later * ease(t)); if (t < 1) requestAnimationFrame(step); };
        requestAnimationFrame(step);
      }
      await g.animate([
        { transform: T(from, 1, 1, 0), opacity: 1, offset: 0 },
        { transform: T(mid, (1 + endS) / 2 + 0.12, (1 + endS) / 2 + 0.12, rxEnd / 2), opacity: 1, offset: 0.5 },
        { transform: T(to, endS, endS, rxEnd), opacity: 1, offset: 1 },
      ], { duration: 700, easing: "cubic-bezier(0.45, 0.05, 0.3, 1)", fill: "forwards" }).finished;
      g.remove();
      cards.forEach((c) => { c.style.opacity = ""; });
      target.animate([{ transform: "scale(1.06)" }, { transform: "scale(1)" }], { duration: 220, easing: "ease-out" });
      fade(cards.filter((c) => c !== target), 320);
      flipIn(450); feedIn(380);
      await wait(480);
    } else if (ev.kind === "confirmed") {
      const cards = $$(`[data-slot$=":${ev.matchId}"].win`);
      cards.forEach((c) => c.classList.add("settle"));
      if (cards[0]) cards[0].getBoundingClientRect();
      requestAnimationFrame(() => requestAnimationFrame(() => cards.forEach((c) => c.classList.remove("settle"))));
      flipIn(full ? 450 : 260); feedIn(full ? 380 : 200);
      await wait(full ? 700 : 300);
    } else {
      feedIn(200); flipIn(260);
      await wait(full ? 560 : 260);
    }
    commitScores();
  }

  /* ---------- go ---------- */
  buildDemo();
  reload();
})();
