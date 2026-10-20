import type { BrowserContext, Page } from "@playwright/test";

/**
 * Landing-order probe: does a moved card show at its destination BEFORE the move animation lands?
 *
 * The owner rule is "animation first, then the card appears in the zone". The probe is black-box: it reads only the DOM and
 * Web Animations of the page, and has no hook in the app.
 *
 *  - Flight: a card ghost of the move layers (`[data-style]`: MoveFx Ghost, the add-to-hand showcase, a Tribute ghost).
 *    Its travel end is the moment the last motion animation (transform, translate, rotate, scale, left, top) on the ghost
 *    finishes. The later dissolve of the ghost over the landed card is opacity only and does not count. A ghost that
 *    only fades (reduced motion, no source) ends with its fade. Its place at the end says which zone it flew to.
 *  - Arrival: a `[data-card-art]` element in a field zone, a pile top (`[data-fi="0"]`) or a hand card that turns from not
 *    visible to visible (computed visibility, opacity chain, a box on screen). It is timed by a MutationObserver and a
 *    rAF sampler on the same clock as the flight (performance.now).
 *  - Early: the first arrival at the zone a flight ended in, minus the flight's travel end. More than one frame early
 *    (or before the ghost existed at all) is a failure.
 */

/** Stored preference that turns full motion on whatever the system setting says. */
const FULL_MOTION_PREFS = { v: 1, soundEnabled: false, motion: "full", shake: "off", volume: 0.7 };

export type ProbeZone = { id: string; kind: string; side: string; seat: string | null; keys?: string; hand?: boolean };
export type ProbeFlight = {
  id: number;
  style: string;
  testid: string | null;
  /** Card art addresses seen in the ghost (several for a face turn). */
  srcs: string[];
  firstSeen: number;
  removedAt: number | null;
  /** performance.now() when the last motion animation finished, or the last animation when there is none. */
  travelEnd: number | null;
  /** Ghost box center at the end of the travel. */
  endAt: { x: number; y: number } | null;
  dest: ProbeZone | null;
  /** The zone under the ghost the first time it was seen (where the card flew from). */
  from: ProbeZone | null;
  /** Frames sampled while the ghost lived (t, x, y), kept for the evidence file. */
  path: Array<[number, number, number]>;
};
export type ProbeArrival = {
  t: number;
  zone: ProbeZone;
  src: string | null;
  /** The card art box at the moment it showed. */
  rect: { x: number; y: number; w: number; h: number };
  /** Share of the opacity chain at that moment. */
  opacity: number;
  via: "mutation" | "frame" | "poll";
};
export type ProbeRaw = {
  armedAt: number;
  readAt: number;
  frameMs: number;
  flights: ProbeFlight[];
  arrivals: ProbeArrival[];
  /** Everything the sampler noticed that was not a flight or an arrival (debug). */
  notes: string[];
};

const PROBE_SOURCE = String.raw`
(() => {
  if (window.__landing) return;
  const GHOST = '[data-style="place"],[data-style="toss"],[data-style="draw"],[data-style="add"],[data-style="fade"],[data-style="tribute"],[data-testid="added-ghost"]';
  const MOTION = new Set(["transform", "translate", "rotate", "scale", "left", "top", "offsetDistance", "offsetPath", "offsetRotate"]);
  const st = { armed: !!window.__landingArmOnLoad, armedAt: 0, flights: [], arrivals: [], notes: [], frames: [] };
  const flightOf = new WeakMap();
  const animSeen = new WeakSet();
  const motionOf = new WeakMap();
  const artVisible = new WeakMap();
  const artSeen = new WeakSet();
  const artSrc = new WeakMap();
  let nextId = 1;
  const now = () => performance.now();

  const opacityOf = (el) => {
    let op = 1;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const cs = getComputedStyle(n);
      op *= parseFloat(cs.opacity);
      if (cs.display === "none") return 0;
    }
    return op;
  };
  const shows = (el) => {
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden") return 0;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return 0;
    return opacityOf(el);
  };
  const zoneIds = new WeakMap();
  let nextZone = 1;
  const zoneId = (el) => { if (!zoneIds.has(el)) zoneIds.set(el, "z" + nextZone++); return zoneIds.get(el); };
  const zoneInfo = (zone) => {
    const field = zone.closest("[data-seat-field]");
    return { id: zoneId(zone), kind: zone.getAttribute("data-kind") || "", side: zone.getAttribute("data-side") || "", seat: field ? field.getAttribute("data-seat-field") : null, keys: zone.getAttribute("data-zones") || "" };
  };
  const zoneOfArt = (art) => {
    const hand = art.closest("[data-hand-card]");
    if (hand) {
      const rail = hand.closest("[data-hand-seat]");
      const seat = rail ? rail.getAttribute("data-hand-seat") : null;
      return { el: hand, zone: { id: "hand:" + seat, kind: "hand", side: rail ? rail.getAttribute("data-side") || "" : "", seat, hand: true } };
    }
    const zone = art.closest("[data-zones]");
    if (!zone) return null;
    // A pile: any card that mounts or is released from hiding counts (a milled card can be covered by the next one at once).
    return { el: zone, zone: zoneInfo(zone) };
  };

  const rectOf = (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };

  const zonesNow = () => {
    const list = [];
    document.querySelectorAll("[data-zones]").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 2) return;
      if (el.closest("[data-hand-card]")) return;
      list.push({ r, zone: zoneInfo(el) });
    });
    document.querySelectorAll("[data-hand-card]").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 2) return;
      const rail = el.closest("[data-hand-seat]");
      const seat = rail ? rail.getAttribute("data-hand-seat") : null;
      list.push({ r, zone: { id: "hand:" + seat, kind: "hand", side: rail ? rail.getAttribute("data-side") || "" : "", seat, hand: true } });
    });
    return list;
  };
  const destAt = (x, y) => {
    let best = null;
    let bestD = Infinity;
    for (const z of zonesNow()) {
      const cx = z.r.left + z.r.width / 2;
      const cy = z.r.top + z.r.height / 2;
      const d = Math.hypot(cx - x, cy - y);
      const lim = Math.max(z.r.width, z.r.height) * 0.75;
      if (d < lim && d < bestD) { best = z.zone; bestD = d; }
    }
    return best;
  };

  const isMotion = (anim) => {
    if (motionOf.has(anim)) return motionOf.get(anim);
    let motion = false;
    try {
      const frames = anim.effect && anim.effect.getKeyframes ? anim.effect.getKeyframes() : [];
      for (const f of frames) for (const k of Object.keys(f)) if (MOTION.has(k)) motion = true;
    } catch (e) { /* ignore */ }
    motionOf.set(anim, motion);
    return motion;
  };

  const trackFlight = (el) => {
    let rec = flightOf.get(el);
    const t = now();
    if (!rec) {
      rec = { id: nextId++, style: el.getAttribute("data-style") || "", testid: el.getAttribute("data-testid"), srcs: [], firstSeen: t, removedAt: null, travelEnd: null, endAt: null, dest: null, from: null, path: [], _el: el, _motionEnd: null, _anyEnd: null, _ended: false, _anims: 0, _firstAnimAt: null };
      flightOf.set(el, rec);
      st.flights.push(rec);
    }
    el.querySelectorAll("img").forEach((img) => { const s = img.getAttribute("src"); if (s && !rec.srcs.includes(s)) rec.srcs.push(s); });
    const r = el.getBoundingClientRect();
    if (rec.path.length === 0) rec.from = destAt(r.left + r.width / 2, r.top + r.height / 2);
    if (rec.path.length < 600 && !rec._ended) rec.path.push([Math.round(t * 10) / 10, Math.round((r.left + r.width / 2) * 10) / 10, Math.round((r.top + r.height / 2) * 10) / 10]);
    if (!rec._ended) rec._lastCenter = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    let anims = [];
    try { anims = el.getAnimations({ subtree: true }); } catch (e) { /* old engine */ }
    for (const anim of anims) {
      if (animSeen.has(anim)) continue;
      animSeen.add(anim);
      const motion = isMotion(anim);
      rec._anims += 1;
      if (rec._firstAnimAt == null) rec._firstAnimAt = t;
      anim.finished.then(() => {
        const at = now();
        if (motion) rec._motionEnd = Math.max(rec._motionEnd || 0, at);
        rec._anyEnd = Math.max(rec._anyEnd || 0, at);
        settle(rec);
      }).catch(() => {
        // A cancelled animation ends the travel where it was cut.
        const at = now();
        if (motion) rec._motionEnd = Math.max(rec._motionEnd || 0, at);
        rec._anyEnd = Math.max(rec._anyEnd || 0, at);
      });
    }
  };

  // The travel is over when the motion animations are done and no new one starts within a frame; a ghost with only fades ends with them.
  const settle = (rec) => {
    queueMicrotask(() => {
      if (rec._ended) return;
      // A later chained travel (showcase, then the flight into the hand) re-opens it: decide on the next frame.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (rec._ended) return;
        const live = rec._el && rec._el.isConnected ? rec._el.getAnimations({ subtree: true }).filter((a) => a.playState === "running" && (isMotion(a) || rec._motionEnd == null)) : [];
        if (live.length > 0) return;
        const end = rec._motionEnd != null ? rec._motionEnd : rec._anyEnd;
        if (end == null) return;
        rec._ended = true;
        rec.travelEnd = end;
        const c = rec._lastCenter;
        rec.endAt = c ? { x: c.x, y: c.y } : null;
        rec.dest = c ? destAt(c.x, c.y) : null;
      }));
    });
  };

  const sample = (via) => {
    const t = now();
    document.querySelectorAll(GHOST).forEach(trackFlight);
    for (const rec of st.flights) {
      if (rec.removedAt == null && rec._el && !rec._el.isConnected) {
        rec.removedAt = t;
        if (!rec._ended) {
          // Removed before the animations reported: its travel ends at removal.
          const end = rec._motionEnd != null ? rec._motionEnd : rec._anyEnd != null ? rec._anyEnd : t;
          rec._ended = true;
          rec.travelEnd = end;
          const c = rec._lastCenter;
          rec.endAt = c ? { x: c.x, y: c.y } : null;
          rec.dest = c ? destAt(c.x, c.y) : null;
        }
      }
    }
    document.querySelectorAll("[data-card-art]").forEach((art) => {
      const where = zoneOfArt(art);
      if (!where) return;
      const op = shows(art);
      const visible = op > 0.02;
      const was = artVisible.get(art);
      artVisible.set(art, visible);
      const first = !artSeen.has(art);
      artSeen.add(art);
      const img = art.querySelector("img");
      const srcNow = img ? img.getAttribute("src") : null;
      const srcBefore = artSrc.get(art);
      artSrc.set(art, srcNow);
      if (!visible) return;
      // An element that stays visible but now shows another card (a pile top reused for the next card) is an arrival too.
      if (was === true && (srcBefore === undefined || srcBefore === srcNow)) return;
      if (!st.armed) return;
      st.arrivals.push({ t, zone: where.zone, src: srcNow, rect: rectOf(art), opacity: Math.round(op * 100) / 100, via, first });
    });
  };

  const mo = new MutationObserver(() => sample("mutation"));
  const start = () => {
    if (!document.documentElement) return setTimeout(start, 5);
    mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class", "data-card-hidden", "src", "data-occupied", "data-hand-id"] });
    let last = now();
    const tick = () => {
      const t = now();
      st.frames.push(t - last);
      if (st.frames.length > 400) st.frames.shift();
      last = t;
      sample("frame");
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    // Background tab or throttled rAF still ends up here.
    setInterval(() => sample("poll"), 25);
  };
  start();

  window.__landing = {
    arm() { st.flights = []; st.arrivals = []; st.notes = []; st.armedAt = now(); st.armed = true; },
    read() {
      const frames = st.frames.slice().sort((a, b) => a - b);
      const frameMs = frames.length ? frames[Math.floor(frames.length / 2)] : 16.7;
      const flights = st.flights.map((f) => { const { _el, _motionEnd, _anyEnd, _ended, _anims, _firstAnimAt, _lastCenter, ...rest } = f; return rest; });
      return { armedAt: st.armedAt, readAt: now(), frameMs, flights, arrivals: st.arrivals, notes: st.notes };
    },
    disarm() { st.armed = false; },
  };
})();
`;

/** Put the probe in every page of the context and turn on full motion (the e2e config reduces motion for software WebGL). */
export async function installLandingProbe(context: BrowserContext, opts: { armOnLoad?: boolean } = {}): Promise<void> {
  if (opts.armOnLoad) await context.addInitScript(() => { (window as unknown as { __landingArmOnLoad: boolean }).__landingArmOnLoad = true; });
  await context.addInitScript((prefs) => {
    try {
      window.localStorage.setItem("yugidraft.duelPreferences.v1", JSON.stringify(prefs));
      window.localStorage.setItem("yugidraft.duelAnimationSpeed.v1", "1");
    } catch {
      // Storage can be blocked; the system setting then decides.
    }
  }, FULL_MOTION_PREFS);
  await context.addInitScript({ content: PROBE_SOURCE });
}

export async function armLandingProbe(page: Page): Promise<void> {
  await page.evaluate(() => (window as unknown as { __landing: { arm(): void } }).__landing.arm());
}

export async function readLandingProbe(page: Page): Promise<ProbeRaw> {
  return page.evaluate(() => (window as unknown as { __landing: { read(): unknown } }).__landing.read()) as Promise<ProbeRaw>;
}

export type Landing = {
  flight: ProbeFlight;
  arrival: ProbeArrival | null;
  /** Travel end minus first arrival at the destination zone, ms. Positive = the card showed before the animation landed. */
  earlyMs: number | null;
  verdict: "ok" | "early" | "before-ghost" | "no-arrival";
};

/**
 * Pairs each flight with an arrival at the zone it ended in. The card must be the same one: the card art of the arrival
 * equals one of the ghost's (a card back, or a ghost without art, matches any). Flights are taken in the order they land;
 * each takes the earliest arrival not taken yet, so a pile that receives two cards in a row keeps one arrival for each,
 * and a card that shows seconds before its flight (a mill that is already on top of the pile) is still found.
 */
export function pairLandings(raw: ProbeRaw): Landing[] {
  const tolerance = Math.max(17, raw.frameMs);
  const flights = raw.flights.filter((f) => f.travelEnd != null).sort((x, y) => x.travelEnd! - y.travelEnd!);
  const key = (src: string | null): string | null => (src ? src.split("?")[0]! : null);
  const same = (f: ProbeFlight, a: ProbeArrival): boolean => {
    const art = key(a.src);
    return art == null || f.srcs.length === 0 || f.srcs.some((s) => key(s) === art);
  };
  const arrivals = raw.arrivals.slice().sort((x, y) => x.t - y.t);
  const used = new Set<ProbeArrival>();
  const pairs = new Map<ProbeFlight, ProbeArrival>();
  for (const f of flights) {
    if (!f.dest) continue;
    const hit = arrivals.find((a) => !used.has(a) && a.zone.id === f.dest!.id && a.t <= f.travelEnd! + 1500 && same(f, a));
    if (hit) {
      used.add(hit);
      pairs.set(f, hit);
    }
  }
  return flights.map((flight): Landing => {
    const arrival = pairs.get(flight) ?? null;
    if (!arrival) return { flight, arrival: null, earlyMs: null, verdict: "no-arrival" };
    const earlyMs = flight.travelEnd! - arrival.t;
    const verdict = arrival.t < flight.firstSeen - tolerance ? "before-ghost" : earlyMs > tolerance ? "early" : "ok";
    return { flight, arrival, earlyMs, verdict };
  });
}

export function describeZone(zone: ProbeZone | null): string {
  if (!zone) return "(no zone)";
  return `${zone.kind}${zone.side ? `/${zone.side}` : ""}${zone.seat != null ? ` seat ${zone.seat}` : ""} [${zone.id}]`;
}
