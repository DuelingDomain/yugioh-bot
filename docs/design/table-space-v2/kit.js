/* Table-space v2 kit: one data model, one renderer. Each page passes a concept (layout preset).
   Board proportions are measured from today's 1920 shot (my card 71 px at z 104): a seat board is
   5.98 z wide and 3.53 z tall, zone pitch 0.78 z, piles at 0.86 scale. */
(() => {
  "use strict";
  const SMALL = (id) => `https://images.ygoprodeck.com/images/cards_small/${id}.jpg`;
  const FULL = (id) => `https://images.ygoprodeck.com/images/cards/${id}.jpg`;
  const CROP = (id) => `https://images.ygoprodeck.com/images/cards_cropped/${id}.jpg`;

  /* ------------------------------------------------------------------ data */
  const C = {
    blueEyes: { id: 89631139, name: "Blue-Eyes White Dragon", atk: 3000, def: 2500 },
    darkMagician: { id: 46986414, name: "Dark Magician", atk: 2500, def: 2100, lv: 7, attr: "DARK", race: "Spellcaster", kind: "Normal", text: "The ultimate wizard in terms of attack and defense." },
    redEyes: { id: 74677422, name: "Red-Eyes Black Dragon", atk: 2400, def: 2000 },
    gaia: { id: 6368038, name: "Gaia The Fierce Knight", atk: 2300, def: 2100 },
    skull: { id: 70781052, name: "Summoned Skull", atk: 2500, def: 1200 },
    sangan: { id: 26202165, name: "Sangan", atk: 1000, def: 600 },
    celtic: { id: 91152256, name: "Celtic Guardian", atk: 1400, def: 1200 },
    raigeki: { id: 12580477, name: "Raigeki", spell: true },
    pot: { id: 55144522, name: "Pot of Greed", spell: true },
    solemn: { id: 41420027, name: "Solemn Judgment", spell: true },
    heavyStorm: { id: 19613556, name: "Heavy Storm", spell: true },
    mirrorForce: { id: 44095762, name: "Mirror Force", spell: true },
    stardust: { id: 44508094, name: "Stardust Dragon", atk: 2500, def: 2000 },
    envoy: { id: 72989439, name: "Black Luster Soldier - Envoy of the Beginning", short: "Envoy of the Beginning", atk: 3000, def: 2500 },
    chaosEmperor: { id: 82301904, name: "Chaos Emperor Dragon", atk: 3000, def: 2500 },
    cyberDragon: { id: 70095154, name: "Cyber Dragon", atk: 2100, def: 1600 },
    blackChaos: { id: 30208479, name: "Magician of Black Chaos", atk: 2800, def: 2600 },
  };
  const TONE = {
    violet: { rgb: "155 126 255", ink: "198 182 255", hex: "#9b7eff", inkHex: "#c6b6ff" },
    ice: { rgb: "92 184 245", ink: "169 220 251", hex: "#5cb8f5", inkHex: "#a9dcfb" },
    verdant: { rgb: "143 211 107", ink: "196 236 173", hex: "#8fd36b", inkHex: "#c4ecad" },
    rose: { rgb: "240 140 196", ink: "251 200 228", hex: "#f08cc4", inkHex: "#fbc8e4" },
  };
  const BASE = [
    { seat: 0, name: "Aster", lp: 8000, hand: ["raigeki", "pot", "celtic", "solemn", "heavyStorm"], deck: 29, extra: 2, extraTop: "stardust", clock: "03:12", master: "envoy", returns: 1, cost: 1000,
      mz: [{ c: "darkMagician" }, { c: "celtic" }, 0, 0, 0], st: [{ back: 1 }, 0, 0, 0, 0] },
    { seat: 1, name: "Rook", lp: 5400, hand: 4, deck: 30, extra: 2, clock: "04:00", master: "chaosEmperor",
      mz: [0, { c: "blueEyes" }, 0, 0, 0], st: [{ back: 1 }, { back: 1 }, 0, 0, 0] },
    { seat: 2, name: "Juniper", lp: 3100, old: 4300, hand: 3, deck: 27, extra: 1, clock: "03:25", master: "cyberDragon", returns: 2, cost: 1500,
      mz: [{ c: "redEyes" }, 0, { c: "gaia" }, 0, 0], st: [{ back: 1 }, { back: 1 }, 0, 0, 0] },
    { seat: 3, name: "Mirelle", lp: 6600, hand: 4, deck: 28, extra: 1, clock: "03:50", master: "blackChaos",
      mz: [{ c: "skull" }, { c: "sangan", back: 1 }, 0, 0, 0], st: [{ back: 1 }, { back: 1 }, 0, 0, 0] },
  ];
  const FORMATS = {
    ffa4: { seats: [0, 1, 2, 3], tone: ["violet", "ice", "verdant", "rose"], label: "Domain · 4-player FFA", short: "FFA4" },
    ffa3: { seats: [0, 1, 2], tone: ["violet", "ice", "verdant"], label: "Domain · 3-player FFA", short: "FFA3" },
    tag: { seats: [0, 1, 2, 3], tone: ["violet", "rose", "ice", "verdant"], label: "Domain · 2v2 Tag", short: "Tag" },
  };
  const HISTORY = [
    { c: "blueEyes", s: 1 }, { c: "mirrorForce", s: 1, set: 1 }, { c: "redEyes", s: 2 }, { c: "gaia", s: 2 },
    { c: "skull", s: 3 }, { c: "blueEyes", s: 1, atk: 1 }, { dmg: "-1200", s: 2 }, { c: "darkMagician", s: 0 },
  ];

  /** The game state for one render: seats with tone, LP, status. */
  function model(S) {
    const F = FORMATS[S.format];
    const out = S.state === "out" && S.format !== "tag" ? 2 : null;
    const seats = F.seats.map((n) => {
      const d = JSON.parse(JSON.stringify(BASE[n]));
      d.tone = F.tone[n];
      d.T = TONE[d.tone];
      if (S.format === "tag") {
        d.team = n % 2 === 0 ? 1 : 2;
        if (d.team === 1) { d.lp = 6800; d.old = 8000; } else { d.lp = 5400; d.old = null; }
      }
      if (n === out) { d.old = d.lp; d.lp = 0; d.elim = true; }
      return d;
    });
    const order = seats.map((d) => d.seat);
    const live = order.filter((n) => n !== out);
    const next = live[(live.indexOf(0) + 1) % live.length];
    seats.forEach((d) => {
      d.status = d.elim ? "eliminated" : d.seat === 0 ? "turn" : d.seat === next ? "next" : "idle";
      d.rival = S.format === "tag" ? d.team !== 1 : d.seat !== 0;
      d.partner = S.format === "tag" && d.seat === 2;
    });
    return { F, seats, by: Object.fromEntries(seats.map((d) => [d.seat, d])), battle: S.state === "attack", out, next };
  }

  /* --------------------------------------------------------------- helpers */
  const r2 = (v) => Math.round(v * 100) / 100;
  const px = (v) => `${r2(v)}px`;
  const fmt = (n) => n.toLocaleString("en-US");
  function el(tag, cls, css, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (css) e.style.cssText = css;
    if (html != null) e.innerHTML = html;
    return e;
  }
  const ICON = {
    hand: '<svg viewBox="0 0 12 12"><rect x="2.5" y="1.5" width="7" height="9" rx="1" fill="none" stroke="currentColor"/></svg>',
    deck: '<svg viewBox="0 0 12 12"><rect x="1.5" y="3" width="6.5" height="8" rx="1" fill="none" stroke="currentColor"/><path d="M4 1.5h5.5a1 1 0 0 1 1 1V9" fill="none" stroke="currentColor"/></svg>',
    diamond: '<svg viewBox="0 0 12 12"><path d="M6 1l5 5-5 5-5-5z" fill="currentColor"/></svg>',
    arrow: '<svg viewBox="0 0 16 16"><path d="M3 8h9M8.5 4.5L12 8l-3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
    mute: '<svg viewBox="0 0 16 16"><path d="M2 6h3l4-3v10l-4-3H2z" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M11 6l4 4M15 6l-4 4" stroke="currentColor" stroke-width="1.3"/></svg>',
    cam: '<svg viewBox="0 0 16 16"><rect x="1.5" y="4" width="9" height="8" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M10.5 7l4-2v6l-4-2" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>',
    card: '<svg viewBox="0 0 20 20"><rect x="5" y="2.5" width="10" height="15" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M7.5 6h5M7.5 9h5" stroke="currentColor" stroke-width="1.2"/></svg>',
    log: '<svg viewBox="0 0 20 20"><path d="M4 5h12M4 10h12M4 15h8" stroke="currentColor" stroke-width="1.5"/></svg>',
    gear: '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="2.6" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M10 2.5v2.5M10 15v2.5M2.5 10H5M15 10h2.5M4.7 4.7l1.8 1.8M13.5 13.5l1.8 1.8M4.7 15.3l1.8-1.8M13.5 6.5l1.8-1.8" stroke="currentColor" stroke-width="1.4"/></svg>',
    crown: '<svg viewBox="0 0 20 20"><path d="M3 15l1.5-8 4 4L10 4l1.5 7 4-4L17 15z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
    home: '<svg viewBox="0 0 12 12"><rect x="1.5" y="1.5" width="9" height="9" rx="1" fill="none" stroke="currentColor"/><circle cx="6" cy="6" r="1.6" fill="currentColor"/></svg>',
    search: '<svg viewBox="0 0 16 16"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M10.5 10.5L14 14" stroke="currentColor" stroke-width="1.4"/></svg>',
  };

  /* ------------------------------------------------------------- the board */
  function cardEl(spec, x, y, w, h, o = {}) {
    const c = el("div", "card", `left:${px(x)};top:${px(y)};width:${px(w)};height:${px(h)}`);
    const info = spec.c ? C[spec.c] : null;
    if (spec.back || !info) c.append(el("i", "back"));
    else {
      const img = el("img", "art");
      img.src = o.big ? FULL(info.id) : SMALL(info.id);
      img.alt = "";
      c.append(img);
    }
    if (spec.x) c.querySelector(".back")?.setAttribute("data-x", "true");
    if (spec.def) c.dataset.def = "true";
    if (o.stack) { c.dataset.stack = "1"; if (spec.x) c.dataset.x = "true"; }
    if (info && !spec.back && info.atk != null && o.plate !== false) {
      c.append(el("span", "plate", null, `<b>${info.atk}</b><i>/</i><em>${info.def}</em>`));
    }
    if (o.measure) {
      c.dataset.m = o.measure;
      ["tl", "tr", "bl", "br"].forEach((k) => {
        const p = el("span", "pr", `${k[0] === "t" ? "top:0" : "bottom:0"};${k[1] === "l" ? "left:0" : "right:0"}`);
        p.dataset.c = k;
        c.append(p);
      });
    }
    return c;
  }

  /**
   * One seat board in its own frame: row 0 (the Extra Monster band) faces the centre of the table.
   * mode "full" = today's board. mode "band" = the shared EMZ pair is drawn in the middle of the table, so row 0
   * shrinks to a front strip that holds Banished, the hand backs and the LP dock.
   */
  function buildBoard(d, o) {
    const z = o.z;
    const band = o.mode === "band";
    const W = 5.98 * z;
    const yE = 0.15 * z;
    const yM = band ? 0.8 * z : 1.26 * z;
    const yS = yM + 1.105 * z;
    const H = yS + 1.165 * z;
    const cw = 0.686 * z;
    const pw = 0.59 * z;
    const ph = 0.86 * z;
    const zx = (i) => 1.077 * z + i * 0.78 * z;
    const xL = 0.154 * z;
    const xR = 5.23 * z;
    const b = el("div", "board", `width:${px(W)};height:${px(H)};--z:${px(z)};--t:${d.T.rgb};--tink:${d.T.ink};--lab:${r2(o.lab || 0)}deg;--dfit:.686`);
    if (o.me) b.dataset.me = "true";
    if (o.opp) b.dataset.opp = "true";
    if (o.quarter) b.dataset.quarter = "true";
    if (o.turn) b.dataset.turn = "true";
    if (o.battle) b.dataset.battle = "true";
    if (d.elim) b.dataset.elim = "true";
    b.dataset.seat = d.seat;
    const matTop = band ? 0.62 * z : 0;
    b.append(el("div", "mat", `left:0;top:${px(matTop)};width:${px(W)};height:${px(H - matTop)}`));
    if (!band) b.append(el("div", "", `position:absolute;left:${px(zx(0) - 0.12 * z)};width:${px(zx(4) + cw - zx(0) + 0.24 * z)};top:${px(0.1 * z)};height:${px(1.1 * z)};border-top:1px solid var(--sheet-lo);border-bottom:1px solid var(--sheet-lo)`));
    const frame = (k, x, y, w, h, extra = "") => {
      const f = el("div", "zf", `left:${px(x)};top:${px(y)};width:${px(w)};height:${px(h)}`);
      f.dataset.k = k;
      if (extra) f.innerHTML = extra;
      b.append(f);
      return f;
    };
    for (let i = 0; i < 5; i += 1) {
      const m = frame("mz", zx(i), yM, cw, z);
      if (o.me && o.guides) m.dataset.guide = "true";
      frame("st", zx(i), yS, cw, z, i === 0 || i === 4 ? `<span class="pmark" style="${i === 0 ? "right:4px;left:auto" : ""}">P</span>` : "");
    }
    const label = (text, x, y, align = "c") => {
      const l = el("span", "lab", `left:${px(x)};top:${px(y)};translate:${align === "c" ? "-50%" : align === "r" ? "-100%" : "0"} 0`, text);
      b.append(l);
      return l;
    };
    // piles
    const piles = band
      ? [["field", xL, yM, "Field", 0], ["extra", xL, yS, "Extra", d.extra], ["gy", xR, yM, "GY", 0], ["deck", xR, yS, "Deck", d.deck]]
      : [["field", xL, yM, "Field", 0], ["extra", xL, yS, "Extra", d.extra], ["ban", xR, yE, "Banished", 0], ["gy", xR, yM, "GY", 0], ["deck", xR, yS, "Deck", d.deck]];
    piles.forEach(([k, x, y, name, n]) => {
      frame("pile", x, y, pw, ph);
      if (k === "deck" && n) b.append(cardEl({ back: 1 }, x, y, pw, ph, { stack: true }));
      if (k === "extra" && n) b.append(cardEl(d.extraTop && o.me ? { c: d.extraTop } : { back: 1, x: 1 }, x, y, pw, ph, { stack: true, plate: false }));
      label(`${name} <b>${n}</b>`, x + pw / 2, y + ph + 0.04 * z);
    });
    if (band) {
      // Banished sits in the front strip, above GY (where a real mat puts it), small
      const bw = 0.4 * z, bh = 0.52 * z, bx = xR + (pw - bw) / 2, by = 0.05 * z;
      frame("pile", bx, by, bw, bh);
      if (o.me) label(`Banished <b>0</b>`, bx + bw + 0.06 * z, by + bh / 2 - 0.05 * z, "l");
      else label(`Banished <b>0</b>`, bx - 0.06 * z, by + bh / 2 - 0.05 * z, "r");
    } else {
      [1, 3].forEach((i) => {
        frame("emz", zx(i), yE, cw, z, `<span class="zname" style="bottom:${px(0.1 * z)}">Extra<br>Monster</span>`);
      });
    }
    // cards
    const cards = {};
    d.mz.forEach((s, i) => {
      if (!s) return;
      const face = !s.back && !s.def;
      const c = cardEl(s, zx(i), yM, cw, z, { measure: face ? `mz-${d.seat}` : null, plate: !o.quarter || true });
      c.dataset.idx = i;
      cards[i] = c;
      b.append(c);
    });
    d.st.forEach((s, i) => { if (s) b.append(cardEl(s, zx(i), yS, cw, z)); });
    // rival hand backs
    if (!o.me && typeof d.hand === "number" && d.hand > 0 && !d.elim) {
      const hw = (band ? 0.36 : 0.46) * z, hh = hw / 0.686, step = hw * (band ? 0.5 : 0.42);
      const total = hw + step * (d.hand - 1);
      const corner = o.handAt === "corner" || o.handAt === "corner-l";
      const hx = o.handAt === "corner-l" ? -0.14 * z - total : corner ? W + 0.14 * z : band ? 3.6 * z - total / 2 : W / 2 - total / 2;
      const hy = corner ? H - hh : band ? 0.06 * z : H + 0.06 * z;
      const fan = el("div", "rhand", `left:${px(hx)};top:${px(hy)};width:${px(total)};height:${px(hh)}`);
      for (let i = 0; i < d.hand; i += 1) fan.append(cardEl({ back: 1 }, i * step, 0, hw, hh));
      fan.append(el("span", "n", `left:${px(corner || band ? total + 6 : -24)};top:${px(hh / 2 - 9)}`, d.hand));
      b.append(fan);
    }
    // seat name on the back edge (today: "ASTER" under your board, rivals' names at their far edge)
    if (o.name !== false) b.append(el("span", "sfName", `left:${px(o.me ? 0 : W * 0.17)};top:${px(H + (o.me ? 0.08 : 0.1) * z)};${o.me ? "" : "translate:-50% 0"}`, d.name));
    if (d.elim) b.append(el("span", "sfOut", `left:${px(W / 2)};top:${px((yM + yS + z) / 2)}`, "Out"));
    // corner probes (local frame)
    const probe = (k, x, y) => { const p = el("span", "pr", `left:${px(x)};top:${px(y)}`); p.dataset.a = k; b.append(p); };
    probe("tl", 0, 0); probe("tr", W, 0); probe("bl", 0, H); probe("br", W, H);
    probe("ml", 0, H / 2); probe("mr", W, H / 2); probe("tm", W / 2, 0); probe("bm", W / 2, H);
    probe("fl", 0, matTop); probe("fr", W, matTop);
    return { el: b, W, H, cards, z, geom: { yM, yS, zx, cw } };
  }

  function buildHand(d, cw, battle) {
    const h = cw / 0.686;
    const gap = cw * 0.2;
    const wrap = el("div", "hand", `width:${px(5 * cw + 4 * gap)};height:${px(h)};--hz:${px(h)};--z:${px(h)}`);
    d.hand.forEach((k, i) => {
      const c = cardEl({ c: k }, i * (cw + gap), 0, cw, h, { measure: "hand" });
      if (!battle && (k === "raigeki" || k === "pot")) { c.dataset.live = "true"; c.append(el("span", "pip")); }
      wrap.append(c);
    });
    return { el: wrap, w: 5 * cw + 4 * gap, h };
  }

  function buildHolo(d, o) {
    const h = el("div", "holo", `--t:${d.T.rgb};--tink:${d.T.ink};--k:${r2(o.k)}`);
    if (o.me) h.dataset.me = "true";
    if (o.active) h.dataset.active = "true";
    if (d.elim) h.dataset.elim = "true";
    if (o.pick) h.dataset.pick = "true";
    h.dataset.lpSeat = d.seat;
    const chip = d.team ? `<span class="chip">Team ${d.team}</span>` : "";
    const hit = d.old != null ? `<span class="hit"><s>${fmt(d.old)}</s><em>−${fmt(d.old - d.lp)}</em></span>` : "";
    const hand = Array.isArray(d.hand) ? d.hand.length : d.hand;
    h.innerHTML = `<div class="body"><span class="dm" style="background-image:url(${SMALL(C[d.master].id)})"></span>
      <div class="tp"><i></i><b>${d.name}${o.me ? " (you)" : ""}</b>${chip}</div>
      <div class="mn"><b>${fmt(d.lp)}</b>${hit}</div>
      <div class="mt"><span>${ICON.hand}${d.elim ? 0 : hand}</span><span>${ICON.deck}${d.deck}</span><span class="clk">${d.clock}</span></div>
      ${o.think ? '<div class="think">choosing…</div>' : ""}</div>${o.key ? `<span class="key">${o.key}</span>` : ""}`;
    return h;
  }

  function buildMasterChip(d, k) {
    const m = C[d.master];
    const e = el("div", "mchip", `--k:${r2(k)}`, `<span class="a" style="background-image:url(${SMALL(m.id)})"></span><div><b>${m.short || m.name}</b><small>Master · Returns ${d.returns} · Next <em>${fmt(d.cost)} LP</em></small></div>`);
    return e;
  }

  /* ------------------------------------------------------------- turn ring */
  function buildRing(M, angles, scale) {
    const R = 48, Cc = 62;
    const rad = (a) => (a * Math.PI) / 180;
    const at = (a, r = R) => ({ x: r2(Cc + Math.cos(rad(a)) * r), y: r2(Cc + Math.sin(rad(a)) * r) });
    const seats = M.seats;
    const ring = seats.filter((d) => !d.elim);
    const arcs = ring.map((d, i) => {
      const lit = d.seat === 0;
      const nx = ring[(i + 1) % ring.length];
      const a0 = angles[d.seat];
      let a1 = angles[nx.seat];
      while (a1 <= a0) a1 += 360;
      if (ring.length > 2 && a1 - a0 > 240) a1 = a0 + 120;
      const s = at(a0 + 16), e = at(a1 - 16);
      return `<path d="M${s.x} ${s.y} A${R} ${R} 0 0 1 ${e.x} ${e.y}" stroke="${lit ? d.T.hex : "rgb(181 153 99 / .45)"}" stroke-width="${lit ? 2 : 1.2}" fill="none" marker-end="url(#${lit ? "ra-lit" : "ra"})"/>`;
    }).join("");
    const pts = ring.map((d) => at(angles[d.seat]));
    const ph = M.battle ? "BATTLE" : "MAIN 1";
    const nodes = seats.map((d, i) => {
      const p = at(angles[d.seat]);
      const out = d.elim, turn = d.status === "turn";
      const label = out ? "OUT" : turn ? "TURN" : d.status === "next" ? "NEXT" : "";
      return `<g>${turn ? `<circle class="pulse" cx="${p.x}" cy="${p.y}" r="13.5" fill="rgb(${d.T.rgb} / .18)" stroke="${d.T.hex}" stroke-width="1.5"/>` : ""}
        <circle cx="${p.x}" cy="${p.y}" r="9.5" fill="${out ? "#2a2826" : `rgb(${d.T.rgb} / ${turn ? 1 : 0.35})`}" stroke="${out ? "#5f5c57" : d.T.hex}" stroke-width="1.2" ${d.status === "next" ? 'stroke-dasharray="2.5 2"' : ""}/>
        <text x="${p.x}" y="${p.y + 3.6}" text-anchor="middle" class="ini" font-size="10.5" fill="${turn ? "#0a0f1c" : out ? "#5f5c57" : d.T.inkHex}">${i + 1}</text>
        ${out ? `<path d="M${p.x - 7} ${p.y + 7} L${p.x + 7} ${p.y - 7}" stroke="#e45a4d" stroke-width="1.6"/>` : ""}
        ${label ? `<text x="${p.x}" y="${p.y + (p.y > Cc ? 25 : -15)}" text-anchor="middle" class="tag" font-size="8" fill="${out ? "#ff9489" : turn ? d.T.inkHex : "#958f81"}">${label}</text>` : ""}</g>`;
    }).join("");
    const r = el("div", "ring", `transform:scale(${r2(scale)})`);
    r.dataset.turnRing = "";
    r.innerHTML = `<svg viewBox="0 0 124 124" aria-hidden="true"><defs>
      <marker id="ra" viewBox="0 0 6 6" refX="3" refY="3" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L6 3L0 6z" fill="rgb(181 153 99 / .6)"/></marker>
      <marker id="ra-lit" viewBox="0 0 6 6" refX="3" refY="3" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L6 3L0 6z" fill="#9b7eff"/></marker>
      <radialGradient id="rdisc"><stop offset="0" stop-color="#121a30"/><stop offset="1" stop-color="#070b15" stop-opacity=".9"/></radialGradient></defs>
      <circle cx="62" cy="62" r="60" fill="url(#rdisc)" stroke="rgb(181 153 99 / .5)"/>
      <circle cx="62" cy="62" r="56" fill="none" stroke="rgb(181 153 99 / .22)" stroke-width=".8" stroke-dasharray="1 3"/>
      <polygon points="${pts.map((p) => `${p.x},${p.y}`).join(" ")}" fill="rgb(228 182 79 / .04)" stroke="rgb(228 182 79 / .55)"/>
      <circle cx="62" cy="62" r="20" fill="#0a0f1c" stroke="rgb(181 153 99 / .6)"/>
      <text x="62" y="62" text-anchor="middle" class="num" font-size="15" fill="#efe7d5">7</text>
      <text x="62" y="73" text-anchor="middle" class="ph" font-size="6.5" fill="${M.battle ? "#d98d52" : "#958f81"}">${ph}</text>
      ${arcs}${nodes}</svg>`;
    return r;
  }

  /* --------------------------------------------------------------- chrome */
  function buildTop(S, M, h) {
    const t = el("div", "top", `height:${px(h)}`);
    t.innerHTML = `<div class="brand"><b>Duelists Kingdom</b><span><i>/</i><em>${M.F.label}</em></span></div>
      <div class="mid"><span>Turn 7</span><span class="sep">·</span><span class="ph">${M.battle ? "Battle Phase" : "Main Phase 1"}</span><span class="pill${M.battle ? " ember" : ""}">${ICON.diamond}Your turn</span></div>
      <div class="right"><span class="live">Live duel</span><span class="sound">${ICON.mute}Sound Off</span></div>`;
    return t;
  }

  function histTiles(S, M, cls = "ht") {
    return HISTORY.slice().reverse().map((h, i) => {
      const d = BASE[h.s];
      const tone = TONE[M.F.tone[h.s]] || TONE.ice;
      if (!M.F.seats.includes(h.s)) return "";
      const style = `--t:${tone.rgb};${h.dmg ? "" : `background-image:url(${h.set ? "assets/card-back-main-hd.webp" : CROP(C[h.c].id)})`}`;
      return `<span class="${cls}" style="${style}" ${h.dmg ? 'data-dmg="true"' : ""} ${h.atk ? 'data-atk="true"' : ""} ${i === 0 ? 'data-new="true"' : ""} title="${d.name}">${h.dmg ? h.dmg : ""}</span>`;
    }).join("");
  }

  function inspectorHTML(u) {
    const m = C.darkMagician;
    return `<img src="${FULL(m.id)}" alt="">
      <h3>Dark Magician</h3><p>Level 7 · Spellcaster / DARK</p><p>Spellcaster / Normal</p>
      <div class="st">ATK 2500 / DEF 2100</div><div class="own"><i></i>Owner <b>Aster</b></div>
      <div class="eff">“${m.text}”</div>`;
  }

  function buildLeftPane(S, M, x, y, w, h) {
    const p = el("div", "lpane", `left:${px(x)};top:${px(y)};width:${px(w)};height:${px(h)}`);
    p.innerHTML = `<div class="hist"><header><span>History</span><span>Newest first · Log</span></header><div class="row">${histTiles(S, M)}</div></div>
      <div class="tabs"><span aria-selected="true">Card</span><span>Log</span><span>Settings</span></div>
      <div class="insp">${inspectorHTML()}</div>`;
    return p;
  }

  function masterPanelHTML(d) {
    const m = C[d.master];
    return `<div class="master"><h4>Your Master</h4><div class="mrow"><span class="a" style="background-image:url(${SMALL(m.id)})"></span>
      <div><b>${m.name}</b><small>LIGHT · Level 8</small><small>Warrior</small><div class="s">${m.atk}/${m.def}</div></div></div>
      <dl><dt>Status</dt><dd>Elsewhere</dd><dt>Returns</dt><dd>${d.returns}</dd><dt>Next surcharge</dt><dd>${fmt(d.cost)} LP</dd></dl></div>`;
  }

  function buildRightPane(S, M, x, y, w, h) {
    const p = el("div", "rpane", `left:${px(x)};top:${px(y)};width:${px(w)};height:${px(h)}`);
    p.innerHTML = `${masterPanelHTML(M.by[0])}<div style="flex:1"></div><div class="pbtn">${ICON.search}<span>Inspect</span></div><div class="pbtn view"><span style="display:flex;gap:8px;align-items:center">${ICON.cam}View</span><kbd>H</kbd></div>`;
    p.querySelectorAll(".pbtn svg").forEach((s) => (s.style.cssText = "width:14px;height:14px"));
    return p;
  }

  function buildRail(S, M, x, y, w, h) {
    const r = el("div", "rail", `left:${px(x)};top:${px(y)};width:${px(w)};height:${px(h)}`);
    const tab = S.panes === "drawer" ? "card" : "";
    r.innerHTML = `<span class="cap">History</span>${histTiles(S, M)}<hr>
      <span class="ic" aria-selected="${tab === "card"}">${ICON.card}<span>Card</span></span>
      <span class="ic">${ICON.log}<span>Log</span></span>
      <span class="ic">${ICON.crown}<span>Master</span></span>
      <span class="ic">${ICON.gear}<span>Settings</span></span>
      <span class="grow"></span><span class="ic">${ICON.cam}<span>View</span></span>`;
    return r;
  }

  function buildDrawer(S, M, x, y, w, h) {
    const d = el("div", "drawer", `left:${px(x)};top:${px(y)};width:${px(w)};height:${px(h)}`);
    d.innerHTML = `<div class="dh"><span>Card · Log · Settings · Master</span><kbd>Esc</kbd></div>
      <div class="tabs" style="grid-template-columns:repeat(4,1fr)"><span aria-selected="true">Card</span><span>Log</span><span>Master</span><span>Settings</span></div>
      <div class="insp">${inspectorHTML()}</div>`;
    return d;
  }

  function seatTags(M, d) {
    const t = [];
    if (d.seat === 0) t.push('<span class="tg">You</span>', '<span class="tg turn">To play</span>', `<span class="tg ch">${M.battle ? "Attacking" : "Choosing"}</span>`);
    if (d.status === "next") t.push('<span class="tg">Next</span>');
    if (d.elim) t.push('<span class="tg out">Out</span>');
    if (d.partner) t.push('<span class="tg">Partner</span>');
    return t.join("");
  }

  function buildStrip(S, M, y, h) {
    const s = el("div", "strip", `top:${px(y)};height:${px(h)};grid-template-columns:repeat(${M.seats.length},1fr)`);
    s.innerHTML = M.seats.map((d, i) => `<div class="si" ${d.seat === 0 ? 'data-me="true"' : ""} style="--t:${d.T.rgb}"><span class="o">${i + 1}</span><span class="dot"></span><b>${d.name}</b><span class="tags">${seatTags(M, d)}</span></div>`).join("");
    return s;
  }

  function trackChips(M, compact) {
    const order = [["DP", "Draw"], ["SP", "Standby"], ["M1", "Main 1"], ["BP", "Battle"], ["M2", "Main 2"], ["EP", "End"]];
    const cur = M.battle ? 3 : 2;
    return `<div class="chips">${order.map(([a, b], i) => `${i ? `<span class="ln" style="${compact ? "width:calc(14px * var(--u))" : ""}"></span>` : ""}<span class="ch" data-s="${i < cur ? "done" : i === cur ? "now" : i === cur + 1 ? "next" : ""}" ${i === cur && M.battle ? 'data-b="true"' : ""} style="${compact ? "min-width:calc(58px * var(--u))" : ""}"><b>${a}</b><small>${b}</small></span>`).join("")}</div>`;
  }

  function buildTrack(S, M, h, merged) {
    const t = el("div", "track", `height:${px(h)};grid-template-columns:${merged ? "minmax(0,auto) minmax(0,auto) minmax(0,1fr) auto" : "minmax(260px,1fr) minmax(0,calc(46rem * var(--u))) minmax(260px,1fr)"};${merged ? "column-gap:calc(16px * var(--u))" : ""}`);
    if (M.battle) t.dataset.battle = "true";
    const hint = M.battle
      ? `<span class="hint" data-b="true"><b>Battle</b> · Pick a target for Dark Magician · Esc to cancel</span>`
      : `<span class="hint"><b>Main 1</b> · Summon or Set a monster, activate or Set Spells and Traps · <span style="color:var(--pen-ink)">Next: Battle</span></span>`;
    const who = `<div class="who"><span class="lamp"></span><div><b>Aster</b><small>Turn 7</small></div><span class="clock">3:12</span></div>`;
    const seats = merged ? `<div class="seats">${M.seats.map((d, i) => `<span class="sc" ${d.seat === 0 ? 'data-me="true"' : ""} ${d.elim ? 'data-out="true"' : ""} style="--t:${d.T.rgb}"><span class="dot"></span><b>${d.name}</b>${seatTags(M, d).replace(/You<\/span>/, "You</span>")}</span>`).join("")}</div>` : "";
    const act = M.battle
      ? `<div class="act"><span class="btn">Cancel</span><span class="btn go b">To Main 2${ICON.arrow}</span></div>`
      : `<div class="act"><span class="btn">End Turn</span><span class="btn go">To Battle${ICON.arrow}</span></div>`;
    t.innerHTML = `${who}${seats}<div class="mid">${trackChips(M, merged)}${hint}</div>${act}`;
    if (merged) {
      t.querySelector(".who").style.paddingLeft = "calc(14px * var(--u))";
      t.querySelector(".who .clock").style.marginRight = "0";
      t.querySelectorAll(".sc .tg").forEach((g) => { if (/You|To play/.test(g.textContent)) g.remove(); });
    }
    return t;
  }

  function buildCam(u) {
    return el("div", "cam", "", `${ICON.home}<b>HOME</b><span>Tab focus · P look · O overview</span>`);
  }

  /* ---------------------------------------------------------------- plaza */
  function buildPlaza(st, o) {
    const p = el("div", "plaza");
    p.innerHTML = `<svg class="skyline" viewBox="0 0 1100 170" preserveAspectRatio="none" style="height:${px(o.skyH)}"><defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#10172a"/><stop offset="1" stop-color="#0a1020" stop-opacity="0"/></linearGradient></defs>
      <path d="M0 170V96h38V70h26v26h30V48h34v48h22V82h40V58h30v38h36V36h28v60h26V74h44V52h32v44h30V88h38V40h30v56h28V64h42v32h34V80h30V54h36v42h28V70h40V96h34V60h30v36h34V84h38v86z" fill="url(#sky)" stroke="rgb(181 153 99 / .18)"/>
      <g transform="translate(517 18)"><rect width="66" height="17" rx="1.5" fill="#140c04" stroke="#e4b64f" stroke-opacity=".6"/><text x="33" y="12.5" text-anchor="middle" font-size="11" font-weight="700" letter-spacing="2" fill="#ffe2a8" font-family="Sofia Sans Semi Condensed, sans-serif">ARENA 07</text></g></svg>`;
    const plane = el("div", "floorPlane", `left:${px(o.cx)};top:${px(o.cy)};transform:${o.tilt ? `perspective(${o.persp || 1100}px) rotateX(${o.tilt}deg) ` : ""}scale(${r2(o.scale)})`);
    const fl = el("div", "floor", "", '<span class="rim"></span><span class="pool"></span>');
    if (o.tilt) fl.dataset.lit = "true";
    plane.append(fl);
    p.append(plane);
    (o.pads || []).forEach((q) => p.append(el("span", "pad", `left:${px(q.x)};top:${px(q.y)};--t:${q.rgb};rotate:${q.rot || 0}deg;scale:${r2(q.scale)}`)));
    p.append(el("span", "edge"));
    return p;
  }

  /* -------------------------------------------------------- measuring */
  function ctxFor(screen, stage, scale) {
    const sr = stage.getBoundingClientRect();
    const pt = (node) => { const r = node.getBoundingClientRect(); return { x: (r.left + r.width / 2 - sr.left) / scale, y: (r.top + r.height / 2 - sr.top) / scale }; };
    const rect = (node) => { const r = node.getBoundingClientRect(); return { x: (r.left - sr.left) / scale, y: (r.top - sr.top) / scale, w: r.width / scale, h: r.height / scale }; };
    const anchors = (seatEl) => { const a = {}; seatEl.querySelectorAll(".board > .pr[data-a]").forEach((p) => (a[p.dataset.a] = pt(p))); return a; };
    return { pt, rect, anchors };
  }
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  function cardWidth(ctx, card) {
    const q = {};
    card.querySelectorAll(":scope > .pr[data-c]").forEach((p) => (q[p.dataset.c] = ctx.pt(p)));
    return (dist(q.tl, q.tr) + dist(q.bl, q.br)) / 2;
  }

  /* ---------------------------------------------------------- aim arrow */
  function buildAim(from, to, w, h) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "aim");
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    svg.style.width = px(w); svg.style.height = px(h);
    const mx = (from.x + to.x) / 2, my = (from.y + to.y) / 2;
    const dx = to.x - from.x, dy = to.y - from.y, len = Math.hypot(dx, dy);
    const bend = Math.min(90, len * 0.18);
    const cx = mx - (dy / len) * bend * Math.sign(dx || 1), cy = my + (dx / len) * bend * Math.sign(dx || 1) * 0.3 - bend * 0.4;
    // stop short of the target centre so the head sits on the card edge
    const t = 1 - 26 / len;
    const ex = (1 - t) * (1 - t) * from.x + 2 * (1 - t) * t * cx + t * t * to.x;
    const ey = (1 - t) * (1 - t) * from.y + 2 * (1 - t) * t * cy + t * t * to.y;
    svg.innerHTML = `<defs><linearGradient id="aimg" gradientUnits="userSpaceOnUse" x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}"><stop offset="0" stop-color="#d98d52" stop-opacity=".25"/><stop offset=".55" stop-color="#ffb070"/><stop offset="1" stop-color="#ffe0b8"/></linearGradient>
      <marker id="aimh" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5.5" markerHeight="5.5" orient="auto"><path d="M0 0L10 5L0 10L2.5 5z" fill="#ffe0b8"/></marker></defs>
      <path d="M${r2(from.x)} ${r2(from.y)} Q${r2(cx)} ${r2(cy)} ${r2(ex)} ${r2(ey)}" stroke="rgb(217 141 82 / .35)" stroke-width="12" fill="none" stroke-linecap="round" style="filter:blur(4px)"/>
      <path d="M${r2(from.x)} ${r2(from.y)} Q${r2(cx)} ${r2(cy)} ${r2(ex)} ${r2(ey)}" stroke="url(#aimg)" stroke-width="3.5" fill="none" stroke-linecap="round" marker-end="url(#aimh)"/>
      <circle cx="${r2(to.x)}" cy="${r2(to.y)}" r="22" fill="none" stroke="#ffe0b8" stroke-width="1.5" stroke-dasharray="4 4" opacity=".85"/>`;
    return svg;
  }

  /* ============================================================ render */
  const KIT = { C, TONE, BASE, FORMATS, concepts: {} };
  let LAST = null;

  KIT.render = function render(host, S) {
    const concept = KIT.concepts[S.concept];
    const M = model(S);
    const u = Math.max(0.95, Math.min(1.3, S.vh / 1080));
    S.u = u;
    const ch = concept.chrome(S, u);
    const prev = LAST && LAST.concept === S.concept && LAST.format === S.format ? capture(host) : null;
    host.innerHTML = "";
    const screen = el("div", "screen", `width:${S.vw}px;height:${S.vh}px;--u:${r2(u)}`);
    if (M.battle) screen.dataset.battle = "true";
    host.append(screen);
    screen.append(buildTop(S, M, ch.top - (ch.harness || 0)));
    const st = { x: ch.left, y: ch.top, w: S.vw - ch.left - ch.right, h: S.vh - ch.top - ch.bottom };
    const stage = el("div", "stage", `left:${px(st.x)};top:${px(st.y)};width:${px(st.w)};height:${px(st.h)}`);
    screen.append(stage);
    const L = concept.layout(S, M, st, u);

    stage.append(buildPlaza(st, L.plaza));
    // seats
    const seatEls = {};
    L.seats.forEach((p) => {
      const d = M.by[p.seat];
      const legal = M.battle && d.rival && !d.elim;
      const built = buildBoard(d, { z: p.z, mode: p.mode, lab: -((p.rot || 0) + (p.yaw || 0)), me: p.seat === 0, opp: p.opp, quarter: p.quarter, turn: p.seat === 0, battle: M.battle, guides: p.guides, name: p.name, handAt: p.handAt });
      if (legal) Object.values(built.cards).forEach((c) => { c.append(el("span", "glow")); });
      const w = el("div", "seat", `left:${px(p.cx - built.W / 2)};top:${px(p.cy - built.H / 2)};width:${px(built.W)};height:${px(built.H)};transform:perspective(${r2((p.persp || 1500) * (S.concept === "original" ? 1 : u))}px) rotateX(${p.tilt || 0}deg) rotateZ(${r2((p.rot || 0) + (p.yaw || 0))}deg)`);
      w.dataset.seat = p.seat;
      w.append(built.el);
      if (p.onclick) { w.style.cursor = "pointer"; w.addEventListener("click", p.onclick); }
      stage.append(w);
      seatEls[p.seat] = { w, built, p };
    });
    // hand
    const me = M.by[0];
    const hand = buildHand(me, L.hand.cw, M.battle);
    hand.el.style.left = px(L.hand.cx - hand.w / 2);
    hand.el.style.top = px(L.hand.y);
    stage.append(hand.el);
    // ring
    const ringScale = L.ring.scale;
    const ctx0 = ctxFor(screen, stage, 1);
    const angles = {};
    M.seats.forEach((d) => {
      const s = seatEls[d.seat];
      const a = s ? ctx0.anchors(s.w) : null;
      const c = a ? { x: (a.tl.x + a.br.x) / 2, y: (a.tl.y + a.br.y) / 2 } : { x: L.ring.x, y: L.ring.y + 100 };
      let ang = (Math.atan2(c.y - L.ring.y, c.x - L.ring.x) * 180) / Math.PI;
      if (d.seat === 0) ang = 90;
      angles[d.seat] = (ang + 360) % 360;
    });
    const ring = buildRing(M, angles, ringScale);
    ring.style.left = px(L.ring.x - 62 * ringScale);
    ring.style.top = px(L.ring.y - 62 * ringScale);
    ring.style.transformOrigin = "0 0";
    stage.append(ring);
    // shared EMZ pairs
    (L.emz || []).forEach((q) => {
      const cw = 0.686 * q.z, gap = 0.12 * q.z;
      const pair = el("div", "emzPair", `left:${px(q.x - cw - gap / 2)};top:${px(q.y - q.z / 2)};width:${px(2 * cw + gap)};height:${px(q.z)};--z:${px(q.z)};--k:${r2(q.k || 1)}`);
      pair.innerHTML = `<span class="lnk"></span>`;
      [0, 1].forEach((i) => {
        const f = el("div", "zf", `left:${px(i * (cw + gap))};top:0;width:${px(cw)};height:${px(q.z)}`, `<span class="zname" style="bottom:${px(0.1 * q.z)}">Extra<br>Monster</span>`);
        f.dataset.k = "emz";
        pair.append(f);
      });
      pair.append(el("span", "cap", `top:${px(q.z + 4)}`, q.label));
      stage.append(pair);
    });
    // after-measure: plates, chips, aim
    const ctx = ctxFor(screen, stage, 1);
    const P = concept.place(S, M, st, L, ctx, seatEls, u);
    const plates = {};
    M.seats.forEach((d) => {
      const q = P.holo[d.seat];
      if (!q) return;
      const h = buildHolo(d, { k: q.k, me: d.seat === 0, active: d.seat === 0, think: d.seat === 0 && !M.battle, pick: M.battle && d.rival && !d.elim, key: q.key });
      stage.append(h);
      const wpx = (d.seat === 0 ? 212 : 196) * q.k;
      const hpx = h.getBoundingClientRect().height;
      let x = q.x, y = q.y;
      if (q.ax === "r") x -= wpx;
      if (q.ax === "c") x -= wpx / 2;
      if (q.ay === "b") y -= hpx;
      if (q.ay === "c") y -= hpx / 2;
      h.style.left = px(x);
      h.style.top = px(y);
      plates[d.seat] = h;
    });
    if (P.master) {
      const m = buildMasterChip(me, P.master.k);
      stage.append(m);
      const r = m.getBoundingClientRect();
      m.style.left = px(P.master.x - (P.master.ax === "r" ? r.width : 0));
      m.style.top = px(P.master.y - (P.master.ay === "b" ? r.height : 0));
    }
    const cam = buildCam(u);
    stage.append(cam);
    const cr = cam.getBoundingClientRect();
    cam.style.left = px(P.cam.x);
    cam.style.top = px(P.cam.y - (P.cam.ay === "b" ? cr.height : 0));
    // attack target picking
    if (M.battle) {
      const attacker = seatEls[0].built.cards[0];
      attacker.append(el("span", "glow", "border-color:#ffb070;box-shadow:0 0 10px rgb(255 176 112 / .9),0 0 22px rgb(217 141 82 / .5)"));
      const tgtSeat = P.target ?? 3;
      const tgtCard = seatEls[tgtSeat]?.built.cards[0];
      if (tgtCard) {
        tgtCard.querySelector(".glow")?.setAttribute("data-aim", "true");
        stage.append(buildAim(ctx.pt(attacker), ctx.pt(tgtCard), st.w, st.h));
      }
    }
    // hover inspector (Wide)
    if (S.panes === "hover" && P.hover) {
      const hv = el("div", "hoverInsp", `left:${px(P.hover.x)};top:${px(P.hover.y)}`, `<img src="${SMALL(C.darkMagician.id)}" alt=""><div><h5>Dark Magician</h5><p>Level 7 · Spellcaster / DARK · Normal</p><div class="s">ATK 2500 / DEF 2100</div><div class="e">“${C.darkMagician.text}”</div><p style="margin-top:6px"><span style="color:var(--pen-ink)">●</span> Owner Aster · click to pin</p></div>`);
      stage.append(hv);
      const dmRect = ctx.rect(seatEls[0].built.cards[0]);
      if (P.hover.auto) { hv.style.left = px(dmRect.x - hv.getBoundingClientRect().width - 14); hv.style.top = px(dmRect.y - 10); }
    }
    // chrome around the stage
    concept.chromeBuild(S, M, screen, st, ch, u, { el, buildLeftPane, buildRightPane, buildRail, buildDrawer, buildStrip, buildTrack });
    if (prev && concept.fly && !matchMedia("(prefers-reduced-motion: reduce)").matches) fly(prev, stage, seatEls, plates);
    LAST = { concept: S.concept, format: S.format };
    return { screen, stage, seatEls, ctx, M };
  };

  /** Spotlight camera-fly: each seat slides from where it was to its new place. */
  function capture(host) {
    const out = {};
    host.querySelectorAll(".stage > .seat").forEach((s) => { const r = s.getBoundingClientRect(); out[s.dataset.seat] = r; });
    host.querySelectorAll(".stage > .holo").forEach((s) => { const r = s.getBoundingClientRect(); out[`lp${s.dataset.lpSeat}`] = r; });
    return out;
  }
  function fly(prev, stage, seatEls, plates) {
    const k = KIT.scale || 1;
    Object.entries(seatEls).forEach(([seat, s]) => {
      const a = prev[seat]; if (!a) return;
      const b = s.w.getBoundingClientRect();
      const dx = (a.left + a.width / 2 - b.left - b.width / 2) / k, dy = (a.top + a.height / 2 - b.top - b.height / 2) / k;
      const sc = Math.max(0.3, Math.min(3, a.width / b.width));
      s.w.animate([{ translate: `${dx}px ${dy}px`, scale: `${sc}` }, { translate: "0 0", scale: "1" }], { duration: 620, easing: "cubic-bezier(.2,.7,.2,1)" });
    });
    Object.entries(plates).forEach(([seat, h]) => {
      const a = prev[`lp${seat}`]; if (!a) return;
      const b = h.getBoundingClientRect();
      h.animate([{ translate: `${(a.left - b.left) / k}px ${(a.top - b.top) / k}px` }, { translate: "0 0" }], { duration: 620, easing: "cubic-bezier(.2,.7,.2,1)" });
    });
  }

  /* ------------------------------------------------------------ audits */
  KIT.measure = function measure(res) {
    const { ctx, seatEls, M } = res;
    const out = {};
    M.seats.forEach((d) => {
      const s = seatEls[d.seat];
      if (!s) return;
      const ws = [...s.w.querySelectorAll('.card[data-m^="mz-"]')].map((c) => cardWidth(ctx, c));
      out[d.seat] = ws.length ? Math.round(ws.reduce((a, b) => a + b, 0) / ws.length) : null;
    });
    const hs = [...res.stage.querySelectorAll('.hand .card[data-m="hand"]')].map((c) => cardWidth(ctx, c));
    out.hand = hs.length ? Math.round(hs[0]) : null;
    return out;
  };

  KIT.audit = function audit(res) {
    const flags = [];
    const sc = res.screen.getBoundingClientRect();
    const R = (n) => n.getBoundingClientRect();
    const inter = (a, b, pad = 0) => a.left < b.right - pad && b.left < a.right - pad && a.top < b.bottom - pad && b.top < a.bottom - pad;
    const name = (n) => n.className.baseVal ?? n.className;
    const solids = [...res.screen.querySelectorAll(".holo, .mchip, .hand, .track, .strip, .rail, .lpane, .rpane, .cam, .ring, .emzPair, .top, .hoverInsp, .drawer")];
    for (let i = 0; i < solids.length; i += 1) {
      for (let j = i + 1; j < solids.length; j += 1) {
        const a = solids[i], b = solids[j];
        const pair = [name(a), name(b)].sort().join("|");
        if (/hoverInsp|drawer/.test(pair)) continue; // overlays by design
        if (/^(rail|top)\|/.test(pair) && /rail\|top|lpane\|top|rpane\|top/.test(pair)) continue;
        if (inter(R(a), R(b), 1)) flags.push(`overlap: ${pair}`);
      }
    }
    // plates over other seats' boards (projected polygon)
    const poly = (s) => { const a = res.ctx.anchors(s.w); return [a.fl, a.fr, a.br, a.bl]; };
    const sr = res.stage.getBoundingClientRect();
    const k = KIT.scale || 1;
    res.screen.querySelectorAll(".holo, .mchip, .hand, .ring, .emzPair, .cam").forEach((n) => {
      const r = R(n);
      const box = { l: (r.left - sr.left) / k, t: (r.top - sr.top) / k, r: (r.right - sr.left) / k, b: (r.bottom - sr.top) / k };
      Object.entries(res.seatEls).forEach(([seat, s]) => {
        if (n.dataset.lpSeat === seat) return; // a plate docks on its own board
        if (n.classList.contains("hand") && seat === "0") return;
        if (n.classList.contains("mchip") && seat === "0") return;
        if (polyRect(poly(s), box, 4)) flags.push(`over board ${seat}: ${name(n)}${n.dataset.lpSeat ? " " + n.dataset.lpSeat : ""}`);
      });
    });
    // text outside the screen or clipped
    res.screen.querySelectorAll(".lab, .zname, .sfName, .holo, .mchip, .si b, .tg, .ch, .hint, .btn, .sc, .cam, .brand, .mid, .right, .emzPair .cap").forEach((n) => {
      const r = R(n);
      if (r.width === 0) return;
      if (r.left < sc.left - 1 || r.right > sc.right + 1 || r.top < sc.top - 1 || r.bottom > sc.bottom + 1) flags.push(`off-screen: ${name(n)} "${n.textContent.trim().slice(0, 24)}"`);
      if (n.scrollWidth > n.clientWidth + 1 && getComputedStyle(n).overflow === "hidden") flags.push(`clipped: ${name(n)} "${n.textContent.trim().slice(0, 24)}"`);
    });
    // stage children cut by the stage edge
    res.stage.querySelectorAll(".holo, .mchip, .hand, .cam, .sfName, .rhand").forEach((n) => {
      const r = R(n);
      if (r.left < sr.left - 1 || r.right > sr.right + 1 || r.top < sr.top - 1 || r.bottom > sr.bottom + 1) flags.push(`cut by stage: ${name(n)} ${n.textContent.trim().slice(0, 16)}`);
    });
    // track: chips/hint/buttons must not overlap each other
    const tk = res.screen.querySelector(".track");
    if (tk) {
      const parts = [...tk.querySelectorAll(":scope > .who, :scope > .seats, :scope > .mid .chips, :scope > .mid .hint, :scope > .act")];
      for (let i = 0; i < parts.length; i += 1) for (let j = i + 1; j < parts.length; j += 1) if (inter(R(parts[i]), R(parts[j]), 1)) flags.push(`track overlap: ${name(parts[i])}|${name(parts[j])}`);
      if (tk.scrollWidth > tk.clientWidth + 1) flags.push("track overflow");
    }
    return [...new Set(flags)];
  };

  KIT.polyRect = polyRect;
  function polyRect(pts, b, pad) {
    const rect = [{ x: b.l + pad, y: b.t + pad }, { x: b.r - pad, y: b.t + pad }, { x: b.r - pad, y: b.b - pad }, { x: b.l + pad, y: b.b - pad }];
    const axes = [];
    const add = (P) => P.forEach((p, i) => { const q = P[(i + 1) % P.length]; axes.push({ x: -(q.y - p.y), y: q.x - p.x }); });
    add(pts); add(rect);
    return axes.every((ax) => {
      const pr = (P) => P.map((p) => p.x * ax.x + p.y * ax.y);
      const a = pr(pts), c = pr(rect);
      return Math.max(...a) > Math.min(...c) && Math.max(...c) > Math.min(...a);
    });
  }

  /* --------------------------------------------------------- page mount */
  KIT.mount = function mount(opts) {
    const Q = new URLSearchParams(location.search);
    const shot = Q.get("shot") === "1";
    const V = { 1920: [1920, 1080], 1440: [1440, 900], 2560: [2560, 1440] };
    const S = {
      concept: opts.concept,
      v: Q.get("v") || "1920",
      format: Q.get("format") || "ffa4",
      state: Q.get("state") || "idle",
      panes: Q.get("panes") || opts.defaultPanes || "rail",
      focus: Q.get("focus") || "N",
      harness: Q.get("harness") === "1",
    };
    document.body.dataset.shot = shot ? "1" : "0";
    const vp = el("div", "vp");
    const fit = el("div", "fit");
    vp.append(fit);
    let bar = null;
    if (!shot) {
      bar = el("div", "ctl");
      document.body.append(bar);
    }
    document.body.append(vp);
    const groups = [
      ["v", "Viewport", [["1920", "1920×1080"], ["1440", "1440×900"], ["2560", "2560×1440"]]],
      ["format", "Format", [["ffa4", "FFA4"], ["ffa3", "FFA3"], ["tag", "Tag"]]],
      ["state", "State", [["idle", "Idle"], ["attack", "Attack target"], ["out", "Seat out"]]],
    ];
    if (opts.panes) groups.push(["panes", "Panes", opts.panes]);
    if (opts.focus) groups.push(["focus", "Focus", [["W", "West"], ["N", "Across"], ["E", "East"]]]);
    function drawBar() {
      if (!bar) return;
      bar.innerHTML = `<b class="t">${opts.title}</b>` + groups.map(([k, lab, items]) => `<div class="g" role="group" aria-label="${lab}"><span>${lab}</span>${items.map(([v, t]) => `<button type="button" data-k="${k}" data-v="${v}" aria-pressed="${S[k] === v}" ${k === "state" && v === "out" && S.format === "tag" ? 'disabled title="A Tag team leaves together"' : ""}>${t}</button>`).join("")}</div>`).join("") + `<a href="compare.html" target="_top">compare ↗</a>`;
      bar.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => { S[b.dataset.k] = b.dataset.v; if (S.format === "tag" && S.state === "out") S.state = "idle"; go(); }));
    }
    let res = null;
    function go() {
      const [vw, vh] = V[S.v] || V[1920];
      S.vw = vw; S.vh = vh;
      if (opts.focus && S.format === "ffa3" && S.focus === "E") S.focus = "N";
      res = KIT.render(fit, S);
      const availW = window.innerWidth, availH = window.innerHeight - (shot ? 0 : bar.getBoundingClientRect().height);
      const k = shot ? 1 : Math.min(availW / vw, availH / vh, 1);
      KIT.scale = k;
      res.screen.style.transform = `scale(${k})`;
      fit.style.width = px(vw * k); fit.style.height = px(vh * k);
      if (!shot) { vp.style.top = px(bar.getBoundingClientRect().height); }
      drawBar();
      const qs = new URLSearchParams(location.search);
      ["v", "format", "state", "panes", "focus"].forEach((k2) => { if (k2 === "focus" && !opts.focus) return; if (k2 === "panes" && !opts.panes) return; qs.set(k2, S[k2]); });
      history.replaceState(null, "", `?${qs}`);
      window.__res = res;
    }
    KIT.go = go;
    KIT.S = S;
    if (opts.focus) {
      window.addEventListener("keydown", (e) => {
        if (e.key !== "Tab" || e.target.closest?.(".ctl")) return;
        e.preventDefault();
        const ring = S.format === "ffa3" ? ["W", "N"] : ["W", "N", "E"];
        S.focus = ring[(ring.indexOf(S.focus) + (e.shiftKey ? ring.length - 1 : 1)) % ring.length];
        go();
      });
      KIT.setFocus = (f) => { S.focus = f; go(); };
    }
    window.addEventListener("resize", () => { if (!shot) go(); });
    window.KIT_READY = (async () => {
      try { await document.fonts.ready; } catch (e) { /* fonts optional */ }
      go();
      await Promise.all([...document.images].map((i) => (i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; }))));
      await Promise.all([...document.querySelectorAll("img")].map((i) => (i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; }))));
      return true;
    })();
  };

  KIT.buildHolo = buildHolo;
  window.KIT = KIT;
})();
