/* Cube night: concept A (the Solid Vision table) as a late-night draft with friends.
   Builds on solid-vision.html's table, hologram and duel disk, and adds:
   - friends around the table, each holding their pack; when the last one locks in, every pack moves one seat
   - the binder: your picks and what left packs you'd seen, with search, kind counts and a breakdown
   - one filter for everything: it narrows the binder and lights the matching cards on the table
   - a Full / Calm / Off animation setting in the room (kit-night.js)
   - short reactions from the table (needs a new live event in the real app) */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const body = document.body;
  const stage = $("stage"), table = $("table"), cardsEl = $("cards"), ring = $("ring");
  const holo = $("holo");

  const THEMES = ["Branded Despia", "Swordsoul", "Tearlaments", "Kashtira", "Labrynth", "Snake-Eye"];
  const SEAT_LIST = [
    { name: "Imran" },
    { name: "Kestrel" },
    { name: "Marik_Mains" },
    { name: "voidpriest" },
    { name: "duel.josh" },
    { name: "BlueEyesBen" },
  ].map((s, i) => Object.assign({}, s, { theme: THEMES[i] }));
  const sim = DraftSim.create(Kit.simOptions({ settleMs: 950, seats: SEAT_LIST }));
  const isTheme = sim.options.mode === "theme";
  const N = sim.options.seats.length;
  body.dataset.mode = sim.options.mode;
  const hoverable = matchMedia("(hover: hover)").matches;
  const phoneMq = matchMedia("(max-width: 900px)");
  const drawerMq = matchMedia("(max-width: 1359px) and (min-width: 901px)");
  const arrow = '<svg viewBox="0 0 18 12" aria-hidden="true"><path d="M17 6H2m5-5L2 6l5 5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const sayIcon = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 4.5h12a1.5 1.5 0 0 1 1.5 1.5v6.5A1.5 1.5 0 0 1 16 14H9l-4 3v-3H4a1.5 1.5 0 0 1-1.5-1.5V6A1.5 1.5 0 0 1 4 4.5Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>';
  const KINDS = ["monster", "spell", "trap", "extra"];
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  const S = {
    st: sim.state,
    els: new Map(),
    sel: null,
    hover: null,
    peek: null, // a card from the binder being read
    G: null,
    ticks: [],
    lastSecs: -1,
    last: null,
    packN: 0,
    seen: [], // booster: what your pack held at each step of this pack, for the wheel
    gone: [], // cards that left packs you had seen
    wheel: null,
    tab: "mine",
    order: "type",
    open: new Set(), // expanded binder rows
    newUid: null,
  };
  // one filter for the binder and the table
  const F = { kinds: new Set(), q: "", lvl: new Set(), type: new Set(), attr: new Set(), arch: new Set() };

  /* ---------- geometry (as in A) ---------- */
  function measure() {
    const r = stage.getBoundingClientRect();
    const phone = phoneMq.matches;
    const narrow = !phone && r.width < 820;
    const cols = phone ? 4 : narrow ? 5 : 8, pad = phone ? 14 : 30, gap = phone ? 8 : 10;
    const rows = isTheme ? 2 : phone ? 4 : narrow ? 3 : 2;
    const top = phone ? 34 : 72, extra = phone ? 54 : 74;
    const tilt = phone ? 26 : 40;
    // friends sit off both short sides, so the table leaves them room
    let tw = phone ? Math.min(r.width - 24, 560) : Math.min(980, r.width - 220);
    let cw = (tw - pad * 2 - gap * (cols - 1)) / cols;
    // the table stands on the picks tray, so only the height above the tray counts
    const diskH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--disk-h")) || 112;
    const fit = (r.height - (phone ? diskH + 40 : 150)) / (phone ? 0.93 : 0.8);
    const cwH = ((fit - top - extra - (rows - 1) * gap) / rows) * (59 / 86);
    if (cwH < cw) { cw = Math.max(30, cwH); tw = cw * cols + gap * (cols - 1) + pad * 2; }
    const ch = (cw * 86) / 59;
    // on a phone your theme pool sits below the pack, so the table uses the height
    const poolRow = isTheme && phone ? ch * 0.8 + 22 : 0;
    const th = top + rows * ch + (rows - 1) * gap + extra + poolRow;
    S.G = { phone, cols, pad, gap, rows, tw, th, cw, ch, top, tilt };
    table.style.setProperty("--tw", tw + "px");
    table.style.setProperty("--th", th + "px");
    table.style.setProperty("--tilt", tilt + "deg");
    ring.setAttribute("width", tw);
    ring.setAttribute("height", th);
    ring.setAttribute("viewBox", `0 0 ${tw} ${th}`);
  }

  function slots(n) {
    const G = S.G;
    let big = n <= 4 ? (G.phone ? 1.3 : 1.5) : 1;
    let lane = 0, avail = G.tw;
    if (isTheme && !G.phone) {
      const st = themeStackPoint();
      lane = st.x + st.w + 24;
      avail = G.tw - lane - G.pad;
      big = Math.min(big, avail / (n * G.cw + (n - 1) * G.gap));
    }
    const cw = G.cw * big, ch = G.ch * big, gap = G.gap * big;
    const cols = big > 1 ? n : Math.min(n, G.cols);
    const rows = Math.max(1, Math.ceil(n / cols));
    const zoneH = G.rows * G.ch + (G.rows - 1) * G.gap;
    const blockH = rows * ch + (rows - 1) * gap;
    const y0 = G.top + (zoneH - blockH) / 2;
    const out = [];
    for (let i = 0; i < n; i++) {
      const r = Math.floor(i / cols), c = i % cols;
      const inRow = r === rows - 1 ? n - r * cols : cols;
      const rowW = inRow * cw + (inRow - 1) * gap;
      const x0 = lane ? lane + (avail - rowW) / 2 : (G.tw - rowW) / 2;
      out.push({ x: x0 + c * (cw + gap), y: y0 + r * (ch + gap), w: cw, h: ch });
    }
    return out;
  }

  function zone() {
    const G = S.G;
    const s = slots(isTheme ? sim.options.themePackSize : sim.options.packSize);
    const x = Math.min(...s.map((p) => p.x)), y = Math.min(...s.map((p) => p.y));
    const x2 = Math.max(...s.map((p) => p.x + p.w)), y2 = Math.max(...s.map((p) => p.y + p.h));
    const m = G.phone ? 9 : 16;
    return { x: x - m, y: y - m, w: x2 - x + m * 2, h: y2 - y + m * 2 };
  }

  /* you sit at the near edge; friends go clockwise from your left: left side, far rim, right side */
  function anchorPoint(i) {
    const G = S.G;
    if (i === 0) return { x: G.tw / 2, y: G.th + 30 };
    if (N === 6) {
      const spots = [null, [-46, 0.56], [0.2, -14], [0.5, -14], [0.8, -14], [G.tw + 46, 0.56]];
      const [x, y] = spots[i];
      return { x: x > 1 || x < 0 ? x : G.tw * x, y: y < 0 ? y : G.th * y };
    }
    const t = (i - 1) / Math.max(1, N - 2);
    return { x: G.tw * (0.03 + 0.94 * t), y: -14 };
  }
  function themeStackPoint() {
    const G = S.G;
    if (G.phone) return { x: G.tw * 0.5 - G.cw * 0.4, y: G.th - G.ch * 0.8 - 40, w: G.cw * 0.8, h: G.ch * 0.8 };
    // your pool sits in its own lane on the left, level with the pack
    const zoneH = G.rows * G.ch + (G.rows - 1) * G.gap;
    return { x: G.pad + 6, y: G.top + (zoneH - G.ch) / 2 + 12, w: G.cw, h: G.ch };
  }

  // the pick clock is a line of light round the inside edge of the mat, starting at the middle of the far side
  function buildRing() {
    const G = S.G, e = 4, r = 14, w = G.tw, h = G.th;
    const d = `M${w / 2},${e} H${w - e - r} A${r},${r} 0 0 1 ${w - e},${e + r} V${h - e - r} A${r},${r} 0 0 1 ${w - e - r},${h - e} H${e + r} A${r},${r} 0 0 1 ${e},${h - e - r} V${e + r} A${r},${r} 0 0 1 ${e + r},${e} Z`;
    ring.innerHTML = `<path class="groove" d="${d}"/><g class="segs"></g><g class="spark"><circle class="glow" r="9"/><circle class="fz" r="1.3"/><circle class="fz" r="1.1"/><circle class="fz" r="1.2"/><circle class="hot" r="2.6"/></g>`;
    const path = ring.firstChild;
    const L = path.getTotalLength();
    const n = Math.max(72, Math.min(180, Math.round(L / 13)));
    const pts = (a, b) => [0, 1 / 3, 2 / 3, 1].map((f) => path.getPointAtLength(a + (b - a) * f)).map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
    let html = "";
    for (let k = 0; k < n; k++) {
      const a = (L * k) / n, b = (L * (k + 1)) / n;
      const soft = pts(a, b);
      // the bright core overlaps its neighbour a hair so no seams show
      html += `<g class="sg" style="--d:${Math.round((k * 650) / n)}ms"><polyline class="h" points="${soft}"/><polyline class="m" points="${soft}"/><polyline class="c" points="${pts(a, Math.min(L, b + 0.8))}"/></g>`;
    }
    ring.querySelector(".segs").innerHTML = html;
    S.ticks = [...ring.querySelector(".segs").children];
    S.ringPts = Array.from({ length: 361 }, (_, j) => path.getPointAtLength((L * j) / 360));
    S.spark = ring.querySelector(".spark");
    S.litN = -1;
    S.lastSecs = -1;
  }
  // light the segments for the time left, touching only the ones that change
  function drawRing(frac, turn) {
    const n = S.ticks.length;
    if (!n) return;
    const lit = Math.ceil(frac * n);
    const set = (k, on) => (on ? S.ticks[k].removeAttribute("data-off") : S.ticks[k].setAttribute("data-off", ""));
    if (S.litN < 0) {
      for (let k = 0; k < n; k++) set(k, k >= n - lit);
      S.litN = lit;
    } else if (lit !== S.litN && turn !== "settling" && turn !== "done") {
      for (let k = n - Math.max(lit, S.litN); k < n - Math.min(lit, S.litN); k++) set(k, lit > S.litN);
      S.litN = lit;
    }
    const p = S.ringPts[Math.round((1 - frac) * 360)];
    if (p) S.spark.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
  }
  // a new pick: the line lays itself back round the table
  function relay() {
    delete ring.dataset.flare;
    S.ticks.forEach((t) => { t.style.transition = "none"; t.setAttribute("data-off", ""); });
    ring.getBoundingClientRect();
    S.ticks.forEach((t) => (t.style.transition = ""));
    S.litN = 0;
    ring.dataset.relay = "";
    clearTimeout(S.relayT);
    S.relayT = setTimeout(() => delete ring.dataset.relay, 1100);
  }

  function buildAnchors() {
    const a = $("anchors");
    a.innerHTML = "";
    sim.options.seats.forEach((_, i) => {
      const p = anchorPoint(i);
      const d = document.createElement("div");
      d.className = "anchor";
      d.style.left = p.x + "px";
      d.style.top = p.y + "px";
      a.appendChild(d);
    });
    const ts = $("tstack"), tp = themeStackPoint(), G = S.G;
    ts.style.left = tp.x + "px";
    ts.style.top = tp.y + "px";
    ts.style.width = tp.w + "px";
    ts.style.height = tp.h + "px";
  }

  // friends are drawn upright in the room, pinned to where their anchor lands on the tilted table
  function placeSeats() {
    const sr = stage.getBoundingClientRect();
    [...$("anchors").children].forEach((a, i) => {
      if (i === 0) return;
      const r = a.getBoundingClientRect();
      const p = document.querySelector(`.seat[data-seat="${i}"]`);
      if (!p) return;
      p.style.left = r.left - sr.left + "px";
      p.style.top = r.top - sr.top + "px";
    });
  }

  function hue(name) {
    let h = 0;
    for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
    return h;
  }
  const initials = (name) => {
    const parts = name.replace(/[^A-Za-z0-9]+/g, " ").trim().split(" ");
    const caps = name.match(/[A-Z]/g) || [];
    if (parts.length > 1) return (parts[0][0] + parts[1][0]).toUpperCase();
    if (caps.length > 1) return caps[0] + caps[1];
    return name.slice(0, 2).replace(/^./, (c) => c.toUpperCase());
  };

  function buildSeats() {
    const host = $("seats"), strip = $("strip");
    host.innerHTML = "";
    strip.innerHTML = `<span class="dir" title="Pass direction">${arrow}</span>`;
    sim.options.seats.forEach((s, i) => {
      if (i === 0) return;
      const av = `<i class="av" style="--hue:${hue(s.name)}" aria-hidden="true">${esc(initials(s.name))}</i>`;
      const p = document.createElement("div");
      p.className = "seat";
      p.dataset.seat = i;
      p.dataset.state = "picking";
      p.innerHTML = `<div class="who"><i class="sky"></i>${av}<div class="pk"><i></i><b></b></div></div><div class="nm">${esc(s.name)}</div><div class="st"><span class="stx">Picking</span><span class="dots" aria-hidden="true"><i></i><i></i><i></i></span></div>${isTheme ? `<div class="th">${esc(s.theme)}</div>` : ""}`;
      host.appendChild(p);
      const c = document.createElement("div");
      c.className = "chip-seat";
      c.dataset.seat = i;
      c.dataset.state = "picking";
      c.innerHTML = `${av}<i class="mp"></i><span class="nm">${esc(s.name)}</span>`;
      c.title = s.name;
      strip.appendChild(c);
    });
    const say = document.createElement("button");
    say.type = "button";
    say.className = "ibtn say-btn";
    say.setAttribute("aria-label", "Say something to the table");
    say.setAttribute("aria-controls", "sayPop");
    say.innerHTML = sayIcon;
    say.addEventListener("click", (e) => togglePop("say", e.currentTarget));
    strip.appendChild(say);
  }

  function layoutAll(animate) {
    measure();
    buildAnchors();
    buildRing();
    const pack = S.st.myPack.filter((d) => S.els.has(d.uid));
    const sl = slots(pack.length);
    pack.forEach((d, i) => placeCard(S.els.get(d.uid), sl[i], i, animate));
    requestAnimationFrame(placeSeats);
  }

  /* ---------- cards on the table ---------- */
  function makeCard(d) {
    const el = document.createElement("div");
    el.className = "tcard";
    el.tabIndex = 0;
    el.setAttribute("role", "button");
    el.setAttribute("aria-label", d.card.name);
    el.dataset.uid = d.uid;
    el.dataset.kind = d.kind;
    el.innerHTML = `<span class="mv"><span class="lift"><span class="shadow"></span><span class="flip"><span class="face"><img src="${d.card.img}" alt="" draggable="false"></span><span class="back${d.kind === "extra" ? " x" : ""}"></span></span><span class="ix"></span></span></span>`;
    el.addEventListener("click", () => onCardClick(d.uid));
    el.addEventListener("focus", () => { if (!S.clicking) select(d.uid, false); });
    el.addEventListener("pointerdown", () => { S.clicking = true; setTimeout(() => (S.clicking = false), 0); });
    if (hoverable) {
      el.addEventListener("pointerenter", () => setHover(d.uid));
      el.addEventListener("pointerleave", () => setHover(null));
    }
    cardsEl.appendChild(el);
    S.els.set(d.uid, el);
    return el;
  }
  function placeCard(el, s, i, animate) {
    if (!el || !s) return;
    if (!animate) el.style.transition = "none";
    el.style.setProperty("--x", s.x + "px");
    el.style.setProperty("--y", s.y + "px");
    el.style.setProperty("--w", s.w + "px");
    el.style.setProperty("--h", s.h + "px");
    el.querySelector(".ix").textContent = i < 9 ? String(i + 1) : "";
    if (!animate) { el.offsetWidth; el.style.transition = ""; }
  }
  const dealt = (uid) => S.st.myPack.find((d) => d.uid === uid);
  const myTurn = () => body.dataset.turn === "picking";

  function onCardClick(uid) {
    if (!myTurn()) return;
    if (S.G.phone) return select(uid, true);
    if (S.sel === uid) return doPick(uid);
    select(uid, true);
  }

  function select(uid, fromPointer) {
    if (!myTurn()) return;
    if (S.sel && S.els.get(S.sel)) S.els.get(S.sel).removeAttribute("data-sel");
    S.sel = uid;
    const el = uid && S.els.get(uid);
    if (!el) { hideHolo(); renderInsp(); return; }
    el.setAttribute("data-sel", "");
    if (!fromPointer && document.activeElement !== el) el.focus({ preventScroll: true });
    renderInsp();
    if (S.G.phone) openSheet("card");
    else showHolo(dealt(uid).card, el, false);
  }
  function setHover(uid) {
    S.hover = myTurn() ? uid : null;
    renderInsp();
    if (S.G.phone) return;
    const id = S.hover || S.sel;
    const el = id && S.els.get(id);
    if (el) showHolo(dealt(id).card, el, id !== S.sel);
    else hideHolo(false);
  }

  /* ---------- sheets: one open at a time ---------- */
  function openSheet(which) {
    if (S.G && S.G.phone) {
      body.dataset.sheet = which;
      delete body.dataset.binder;
    } else if (which === "binder" && drawerMq.matches) {
      body.dataset.binder = "";
    }
    if (which === "binder") renderBinder();
  }
  function closeSheets() {
    delete body.dataset.sheet;
    delete body.dataset.binder;
  }
  // a step or a pick only closes the card sheet; the binder stays open while you read it
  function closeCardSheet() {
    if (body.dataset.sheet === "card") delete body.dataset.sheet;
  }
  const binderOpen = () => (phoneMq.matches ? body.dataset.sheet === "binder" : drawerMq.matches ? "binder" in body.dataset : true);
  phoneMq.addEventListener("change", () => { select(null); closeSheets(); });
  drawerMq.addEventListener("change", () => closeSheets());

  /* ---------- reader ---------- */
  function readerTag(e) {
    if (isTheme) return `In your picks, ${e.phase === "extra" ? "Extra deck" : "main deck"} round ${e.phase === "extra" ? e.round - sim.options.cardsPerPlayer : e.round}`;
    return `In your picks, pack ${e.pack} pick ${e.step}`;
  }
  function renderInsp() {
    const d = (S.hover && dealt(S.hover)) || (S.sel && dealt(S.sel));
    const art = $("inspArt"), info = $("inspInfo"), text = $("inspText"), btn = $("pickBtn");
    const showLast = S.last && !myTurn();
    const peek = S.peek && !S.hover ? S.peek : null;
    const card = peek ? peek.card : d ? d.card : showLast ? S.last.card : null;
    art.dataset.empty = card ? "false" : "true";
    $("inspTag").textContent = peek ? peek.tag : d ? (d.uid === S.sel ? "Selected" : "") : showLast ? (S.last.auto === "clock" ? "The clock picked" : "Your pick") : "";
    if (card) {
      art.querySelector("img").src = card.full;
      setPortrait(document.querySelector("#inspMini .portrait"), card);
      const head = `<h2 class="insp-name">${esc(card.name)}</h2><p class="insp-type">${Kit.typeParts(card).map((p) => `<span>${esc(p)}</span>`).join("")}</p>` +
        (Kit.statParts(card) ? `<div class="insp-stats">${Kit.statParts(card).map(([k, v]) => `<span>${k}<b>${v}</b></span>`).join("")}</div>` : "");
      info.innerHTML = S.G.phone ? "" : head;
      $("inspMiniHead").innerHTML = head;
      text.textContent = Kit.desc(card);
    } else {
      info.innerHTML = `<p class="insp-note">Point at a card to read it. Click it to stand it up, then click it again or press Enter to pick.</p>`;
      $("inspMiniHead").innerHTML = "";
      text.textContent = "";
    }
    if (!d && !peek && S.last && !myTurn()) {
      const waiting = S.st.seats.filter((s) => !s.isMe && !s.hasPicked).map((s) => s.name);
      info.insertAdjacentHTML("beforeend", waiting.length ? `<p class="insp-note" style="margin-top:10px">Waiting on <em>${esc(Kit.names(waiting))}</em>.</p>` : "");
    }
    const pickable = d && myTurn();
    btn.hidden = !!peek || body.dataset.turn === "done";
    btn.disabled = !pickable;
    btn.querySelector("span").textContent = pickable ? `Pick ${d.card.name}` : myTurn() ? "Choose a card" : "Picked";
    btn.dataset.uid = pickable ? d.uid : "";
  }
  $("pickBtn").addEventListener("click", () => $("pickBtn").dataset.uid && doPick($("pickBtn").dataset.uid));
  $("sheetX").addEventListener("click", () => { closeSheets(); select(null); });
  $("scrim").addEventListener("click", () => { const card = body.dataset.sheet === "card"; closeSheets(); if (card) select(null); });

  /* ---------- hologram (as in A) ---------- */
  function setPortrait(p, card) {
    const t = Kit.tint(card);
    p.style.setProperty("--h-hi", t.hi);
    p.style.setProperty("--h-main", t.main);
    p.querySelector("img").src = card.art;
  }
  function showHolo(card, el, partial) {
    const swap = holo.hasAttribute("data-on");
    if (swap && holo.dataset.card === String(card.id) && holo.dataset.partial === String(!!partial)) return;
    holo.dataset.card = card.id;
    holo.dataset.partial = String(!!partial);
    const t = Kit.tint(card);
    holo.style.setProperty("--h-hi", t.hi);
    holo.style.setProperty("--h-main", t.main);
    holo.querySelector(".portrait img").src = card.art;
    holo.querySelector(".plate b").textContent = card.name;
    const sp = Kit.statParts(card);
    holo.querySelector(".plate span").textContent = sp ? sp.map((x) => x[1]).join(" / ") : Kit.typeParts(card)[0];
    const motes = holo.querySelector(".motes");
    if (!motes.children.length) {
      for (let i = 0; i < 16; i++) {
        const m = document.createElement("i");
        m.style.left = 4 + Math.random() * 92 + "%";
        m.style.setProperty("--d", 2.2 + Math.random() * 2 + "s");
        m.style.setProperty("--dl", -Math.random() * 3 + "s");
        motes.appendChild(m);
      }
    }
    const sr = stage.getBoundingClientRect();
    const r = el.querySelector(".face").getBoundingClientRect();
    const hw = Math.round(Math.min(230, Math.max(170, sr.height * 0.25)));
    const upright = r.bottom - r.width * 1.12 * (86 / 59) - sr.top;
    const standTop = partial ? (r.top - sr.top + upright) / 2 : upright;
    let top = standTop - 26 - hw - 30;
    top = Math.max(10, top);
    const beam = Math.max(16, standTop - (top + hw) + 6);
    let left = r.left + r.width / 2 - sr.left - hw / 2;
    left = Math.max(10, Math.min(sr.width - hw - 10, left));
    holo.style.setProperty("--hw", hw + "px");
    holo.style.setProperty("--beam", beam + "px");
    holo.style.transform = `translate(${left}px, ${top}px)`;
    holo.setAttribute("data-on", "");
    const pf = holo.querySelector(".pf"), wipe = holo.querySelector(".wipe"), bm = holo.querySelector(".beam"), plate = holo.querySelector(".plate");
    if (Kit.reduced()) return;
    if (swap) {
      Kit.animate(pf, [{ opacity: 0.35, filter: "brightness(1.8)" }, { opacity: 1, filter: "none" }], { duration: 200, easing: "ease-out" });
      return;
    }
    Kit.animate(bm, [{ transform: "scaleY(0)", opacity: 0 }, { transform: "scaleY(1)", opacity: 1 }], { duration: 220, easing: "cubic-bezier(0.2,0.8,0.25,1)" });
    Kit.animate(pf, [{ transform: "translateY(40px) scale(0.55)", opacity: 0 }, { transform: "translateY(-4px) scale(1.02)", opacity: 1, offset: 0.7 }, { transform: "none", opacity: 1 }], { duration: 420, delay: 80, easing: "cubic-bezier(0.16,1,0.3,1)", fill: "backwards" });
    Kit.animate(wipe, [{ transform: "scaleY(1)" }, { transform: "scaleY(0)" }], { duration: 460, delay: 120, easing: "cubic-bezier(0.45,0,0.2,1)", fill: "backwards" });
    Kit.animate(plate, [{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }], { duration: 260, delay: 340, fill: "backwards" });
  }
  function hideHolo(collapse) {
    if (!holo.hasAttribute("data-on")) return Promise.resolve();
    holo.dataset.card = "";
    if (!collapse || Kit.reduced()) { holo.removeAttribute("data-on"); return Promise.resolve(); }
    return Kit.animate(holo, [{ opacity: 1 }, { opacity: 0 }], { duration: 220, easing: "ease-in" }).then(() => holo.removeAttribute("data-on"));
  }

  /* ---------- picking ---------- */
  function doPick(uid) {
    if (!myTurn()) return;
    sim.pick(uid);
  }

  function onPick(e) {
    const { entry } = e;
    S.st = e.snapshot;
    S.last = entry;
    S.newUid = entry.uid;
    if (!isTheme && S.seen.length) S.seen[S.seen.length - 1].mine = entry.uid;
    body.dataset.turn = "waiting";
    S.sel = null;
    S.hover = null;
    closeCardSheet();
    const el = S.els.get(entry.uid);
    const slot = document.querySelector(`.slot[data-kind="${entry.kind}"]`);
    const win = slot.querySelector(".win");
    renderInsp();
    updateStatus();
    const land = () => {
      updateDisk(e.snapshot, entry);
      renderBinder(true);
      applyLens();
      if (!Kit.reduced()) {
        slot.removeAttribute("data-land");
        slot.offsetWidth;
        slot.setAttribute("data-land", "");
      }
      maybeReactToPick(entry);
    };
    if (!el) return land();
    const from = el.querySelector(".face").getBoundingClientRect();
    hideHolo(true);
    el.classList.add("gone");
    Kit.flight({ from, to: win.getBoundingClientRect(), src: entry.card.img, glow: Kit.tint(entry.card).main, arc: S.G.phone ? 60 : 140, duration: 640 }).then(() => {
      el.remove();
      S.els.delete(entry.uid);
      land();
    });
  }

  /* ---------- the duel disk: dial and counts ---------- */
  function mixGradient(c, of) {
    let at = 0;
    const stops = [];
    KINDS.forEach((k) => {
      if (!c[k]) return;
      const a = (at / of) * 100, b = ((at + c[k]) / of) * 100;
      stops.push(`var(--k-${k}) ${a}% ${b}%`);
      at += c[k];
    });
    stops.push(`rgb(255 255 255 / 0.07) ${(at / of) * 100}% 100%`);
    return `conic-gradient(${stops.join(", ")})`;
  }
  function updateDisk(s, landed) {
    const c = s.counts;
    const extraPhase = isTheme && s.phase === "extra";
    const done = isTheme ? (extraPhase ? s.extraDrafted : s.mainDrafted) : c.total;
    const of = isTheme ? (extraPhase ? s.extraDeckSize : s.cardsPerPlayer) : s.cardsPerPlayer;
    $("total").textContent = done;
    $("totalOf").textContent = isTheme ? (extraPhase ? `of ${of} extra` : `of ${of} main`) : `of ${of}`;
    let dc = c;
    if (isTheme) {
      dc = { monster: 0, spell: 0, trap: 0, extra: 0 };
      s.pool.filter((p) => (p.phase === "extra") === extraPhase).forEach((p) => dc[p.kind]++);
    }
    $("dialFace").style.setProperty("--mix", mixGradient(dc, of));
    $("dial").setAttribute("aria-label", `Your picks: ${done} of ${of}. Open your picks.`);
    KINDS.forEach((k) => {
      const slot = document.querySelector(`.slot[data-kind="${k}"]`);
      const b = slot.querySelector("b");
      if (b.textContent !== String(c[k])) {
        b.textContent = c[k];
        if (landed && landed.kind === k && !Kit.reduced()) { b.classList.remove("bump"); b.offsetWidth; b.classList.add("bump"); }
      }
      const last = [...s.pool].reverse().find((p) => p.kind === k);
      slot.querySelector(".win").innerHTML = last ? `<img src="${last.card.img}" alt="">` : "";
      slot.setAttribute("aria-label", `${c[k]} ${Kit.KIND_LABEL[k]}. Show them.`);
    });
    const total = isTheme ? s.cardsPerPlayer + s.extraDeckSize : s.cardsPerPlayer;
    $("progress").style.setProperty("--p", String(c.total / total));
  }

  function updateStatus(text) {
    const st = $("status");
    if (text) { st.innerHTML = text; st.setAttribute("data-on", ""); return; }
    if (body.dataset.turn === "waiting") {
      const waiting = S.st.seats.filter((s) => !s.isMe && !s.hasPicked).map((s) => s.name);
      if (waiting.length) { st.innerHTML = `Picked. Waiting on <em>${esc(Kit.names(waiting))}</em>`; st.setAttribute("data-on", ""); return; }
    }
    st.removeAttribute("data-on");
  }

  function setSeat(i, picked, auto) {
    const label = picked ? (auto ? "Clock picked" : "Picked") : "Picking";
    document.querySelectorAll(`.seat[data-seat="${i}"], .chip-seat[data-seat="${i}"]`).forEach((x) => {
      x.dataset.state = picked ? "picked" : "picking";
      const st = x.querySelector(".stx");
      if (st) st.textContent = label;
      const b = x.querySelector(".pk b");
      if (b) b.textContent = Math.max(0, S.packN - (picked ? 1 : 0));
    });
  }

  /* ---------- steps: deal, pass, new pack ---------- */
  function header(s) {
    const w = $("where");
    if (isTheme) {
      const extra = s.phase === "extra";
      w.innerHTML = `<span class="w">${extra ? "Extra deck" : "Main deck"}</span><span class="w">Pick <b>${extra ? s.extraDrafted + 1 : s.mainDrafted + 1}</b> of ${extra ? s.extraDeckSize : s.cardsPerPlayer}</span><span class="pass">Private pack</span>`;
      $("sub").textContent = `6 at the table, your theme is ${s.theme.name}`;
      $("tstackLabel").innerHTML = `${esc(s.theme.name)}<small>${extra ? "Extra deck pool" : "Main deck pool"}</small>`;
    } else {
      w.innerHTML = `<span class="w">Pack <b>${s.pack}</b> of ${s.totalPacks}</span><span class="w">Pick <b>${s.step}</b> of ${s.stepsInPack}</span><span class="pass">${arrow}${s.direction > 0 ? "Passing left" : "Passing right"}</span>`;
    }
    body.dataset.dir = String(s.direction || 1);
    body.dataset.phase = s.phase;
  }

  // The ribbon carries real news, so it stays up for a moment even with animations off.
  function ribbon(title, sub, tone) {
    const r = $("ribbon");
    r.querySelector("b").textContent = title;
    r.querySelector("span").textContent = sub;
    r.dataset.tone = tone || "";
    r.style.visibility = "visible";
    const hide = () => (r.style.visibility = "hidden");
    if (Kit.reduced()) return Kit.wait(1300).then(hide);
    return Promise.all([
      Kit.animate(r, [{ opacity: 0, transform: "scaleX(0.1)" }, { opacity: 1, transform: "scaleX(1)", offset: 0.18 }, { opacity: 1, transform: "scaleX(1)", offset: 0.82 }, { opacity: 0, transform: "scaleX(1)" }], { duration: 1500, easing: "cubic-bezier(0.2,0.8,0.25,1)" }),
      Kit.animate(r.querySelector("b"), [{ letterSpacing: "0.14em", opacity: 0 }, { letterSpacing: "0.02em", opacity: 1 }], { duration: 420, delay: 80, fill: "backwards" }),
    ]).then(hide);
  }

  function anchorDelta(i, s) {
    const a = i === "stack" ? themeStackPoint() : anchorPoint(i);
    return { x: a.x - (s.x + s.w / 2), y: a.y - (s.y + s.h / 2) };
  }

  function dealIn(pack, from) {
    const sl = slots(pack.length);
    const off = Kit.reduced();
    pack.forEach((d, i) => {
      const el = makeCard(d);
      placeCard(el, sl[i], i, false);
      if (off) return;
      const mv = el.querySelector(".mv"), flip = el.querySelector(".flip");
      if (from === "pass") {
        if (S.G.phone) {
          // on a phone the pack drops in from the seat strip
          Kit.animate(mv, [{ transform: `translate3d(0, ${-S.G.th * 0.7}px, 40px) scale(0.5)`, opacity: 0 }, { opacity: 1, offset: 0.35 }, { transform: "none", opacity: 1 }], { duration: 520, delay: i * 20, easing: "cubic-bezier(0.16,1,0.3,1)", fill: "backwards" });
          return;
        }
        const dl = anchorDelta(S.st.incomingFrom, sl[i]);
        Kit.animate(mv, [{ transform: `translate3d(${dl.x}px, ${dl.y}px, 30px) rotateZ(${S.st.direction * 8}deg) scale(0.5)`, opacity: 0 }, { opacity: 1, offset: 0.25 }, { transform: "none", opacity: 1 }], { duration: 600, delay: i * 22, easing: "cubic-bezier(0.16,1,0.3,1)", fill: "backwards" });
      } else {
        const src = from === "stack" ? anchorDelta("stack", sl[i]) : { x: S.G.tw / 2 - (sl[i].x + sl[i].w / 2), y: S.G.th * 0.45 - (sl[i].y + sl[i].h / 2) };
        const delay = 120 + i * (pack.length > 6 ? 45 : 110);
        Kit.animate(mv, [{ transform: `translate3d(${src.x}px, ${src.y}px, 60px) rotateZ(${(i % 2 ? -1 : 1) * 6}deg)` }, { transform: "none" }], { duration: 480, delay, easing: "cubic-bezier(0.16,1,0.3,1)", fill: "backwards" });
        Kit.animate(flip, [{ transform: "rotateY(180deg)" }, { transform: "rotateY(180deg)", offset: 0.45 }, { transform: "rotateY(0deg)" }], { duration: 760, delay, easing: "cubic-bezier(0.45,0,0.2,1)", fill: "backwards" });
      }
    });
  }

  function clearCards() {
    S.els.forEach((el) => el.remove());
    S.els.clear();
  }

  const nextSeat = (i, d) => (i + d + N) % N;
  function packRect(i) {
    if (S.G.phone) {
      const m = document.querySelector(`.chip-seat[data-seat="${i}"] .mp`);
      return m && m.getBoundingClientRect();
    }
    const m = document.querySelector(`.seat[data-seat="${i}"] .pk i`);
    return m && m.getBoundingClientRect();
  }

  /* Everyone has picked: every pack moves one seat at once.
     Friends' packs fly seat to seat; your leftovers gather and slide to the next friend. */
  function passAll(s) {
    const d = s.direction;
    const target = nextSeat(0, d);
    const off = Kit.reduced();
    const back = body.dataset.phase === "extra" ? "assets/card-back-extra-hd.webp" : "assets/card-back-main-hd.webp";
    // friends' packs
    for (let i = 1; i < N; i++) {
      const to = nextSeat(i, d);
      const from = packRect(i);
      document.querySelectorAll(`.seat[data-seat="${i}"], .chip-seat[data-seat="${i}"]`).forEach((x) => (x.dataset.state = "passing"));
      if (off || !from) continue;
      let dest = to === 0 ? null : packRect(to);
      if (to === 0) {
        // the pack coming to you lands in the middle of the table
        const z = $("table").getBoundingClientRect();
        dest = { left: z.left + z.width / 2 - from.width, top: z.top + z.height * 0.45, width: from.width * 2, height: from.height * 2 };
      }
      if (!dest) continue;
      Kit.flight({ from, to: dest, src: back, glow: "228 182 79", arc: S.G.phone ? 26 : 70, duration: 640, swell: 0.3, keepRatio: true, rotate: d * 12, className: "pack-ghost" });
    }
    // your leftovers
    const list = [...S.els.values()];
    const dest = packRect(target);
    list.forEach((el, i) => {
      const mv = el.querySelector(".mv");
      const done = () => el.remove();
      if (off) return done();
      if (S.G.phone && dest) {
        const r = el.querySelector(".face").getBoundingClientRect();
        el.classList.add("gone");
        Kit.flight({ from: r, to: dest, src: el.querySelector("img").src, glow: "228 182 79", arc: 30, duration: 560 + i * 12, swell: 0, className: "pack-ghost" }).then(done);
        return;
      }
      const x = parseFloat(el.style.getPropertyValue("--x")), y = parseFloat(el.style.getPropertyValue("--y"));
      const w = parseFloat(el.style.getPropertyValue("--w")), h = parseFloat(el.style.getPropertyValue("--h"));
      const dl = anchorDelta(target, { x, y, w, h });
      // gather into a stack first, then slide off together
      const cx = S.G.tw / 2 - (x + w / 2), cy = S.G.th * 0.5 - (y + h / 2);
      Kit.animate(mv, [
        { transform: "none", opacity: 1 },
        { transform: `translate3d(${cx}px, ${cy}px, ${2 + i * 0.6}px) rotateZ(${(i % 3) - 1}deg)`, opacity: 1, offset: 0.42 },
        { transform: `translate3d(${cx}px, ${cy}px, ${2 + i * 0.6}px) rotateZ(${(i % 3) - 1}deg)`, opacity: 1, offset: 0.55 },
        { transform: `translate3d(${dl.x}px, ${dl.y}px, 20px) scale(0.5)`, opacity: 0 },
      ], { duration: 900, delay: i * 10, easing: "cubic-bezier(0.55,0,0.3,1)", fill: "forwards" }).then(done);
    });
    S.els.clear();
  }

  function themeClear() {
    const off = Kit.reduced();
    [...S.els.values()].forEach((el, i) => {
      const x = parseFloat(el.style.getPropertyValue("--x")), y = parseFloat(el.style.getPropertyValue("--y"));
      const w = parseFloat(el.style.getPropertyValue("--w")), h = parseFloat(el.style.getPropertyValue("--h"));
      const dl = anchorDelta("stack", { x, y, w, h });
      if (off) return el.remove();
      Kit.animate(el.querySelector(".mv"), [{ transform: "none", opacity: 1 }, { opacity: 1, offset: 0.7 }, { transform: `translate3d(${dl.x}px, ${dl.y}px, 20px) scale(0.6)`, opacity: 0 }], { duration: 520, delay: i * 18, easing: "cubic-bezier(0.55,0,0.3,1)", fill: "forwards" }).then(() => el.remove());
    });
    S.els.clear();
  }

  /* ---------- the wheel: a pack you've seen comes back ---------- */
  function trackWheel(s, jumped) {
    S.wheel = null;
    if (isTheme) return;
    if (s.reason !== "pass" || jumped) S.seen = [];
    const uids = new Set(s.myPack.map((d) => d.uid));
    // the latest time you held this pack: exactly one lap ago, in this pack
    const prev = S.seen.find((x) => x.step === s.step - N && x.pack === s.pack);
    if (prev && !jumped) {
      const taken = prev.cards.filter((d) => d.uid !== prev.mine && !uids.has(d.uid));
      if (taken.length) {
        taken.forEach((d) => S.gone.push(Object.assign({}, d, { pack: s.pack, seenAt: prev.step, goneBy: s.step })));
        S.wheel = { cards: taken, from: prev.step };
      }
    }
    S.seen.push({ pack: s.pack, step: s.step, cards: s.myPack.slice(), mine: null });
  }
  function renderWheel() {
    const w = $("wheel");
    if (!S.wheel) { w.hidden = true; return; }
    const n = S.wheel.cards.length;
    w.innerHTML = `<span class="lede"><b>Back around.</b> ${n} gone since pick ${S.wheel.from}</span><span class="thumbs">${S.wheel.cards.slice(0, 6).map((d) => `<img src="${d.card.img}" alt="${esc(d.card.name)}" title="${esc(d.card.name)}">`).join("")}</span><button type="button" id="wheelSee">See what went</button>`;
    w.hidden = false;
    $("wheelSee").addEventListener("click", () => { setTab("gone"); openSheet("binder"); });
  }

  async function onStep(s) {
    S.st = s;
    S.sel = null;
    S.hover = null;
    S.peek = null;
    S.packN = s.myPack.length;
    closeCardSheet();
    hideHolo(false);
    header(s);
    updateDisk(s);
    s.seats.forEach((x, i) => i && setSeat(i, false));
    body.dataset.turn = "picking";
    updateStatus();
    const jumped = S.jumped;
    S.jumped = false;
    trackWheel(s, jumped);
    renderWheel();
    clearCards();
    layoutAll(false);
    relay();
    renderInsp();
    renderBinder();
    if (s.reason === "pass") {
      dealIn(s.myPack, jumped ? "deal" : "pass");
      applyLens();
      if (S.wheel && S.wheel.cards.length >= 4) botSay("no way", 0.5);
      return;
    }
    if (isTheme) {
      if (s.reason === "start") await ribbon("Theme draft", `Your pool: ${s.theme.name}. Nothing passes.`);
      if (s.reason === "phase") await ribbon("Extra deck", `Main deck done. Pick ${s.extraDeckSize} for your Extra Deck.`, "extra");
      if (S.st !== s) return;
      dealIn(s.myPack, "stack");
      applyLens();
      return;
    }
    if (s.reason === "start" || s.reason === "pack") {
      botSay("gl", s.reason === "start" ? 0.9 : 0.6, 900);
      await ribbon(`Pack ${s.pack}`, s.direction > 0 ? "Passing left" : "Passing right");
      if (S.st !== s) return;
    }
    dealIn(s.myPack, "deal");
    applyLens();
  }

  function onSettle(s) {
    S.st = s;
    body.dataset.turn = "settling";
    delete ring.dataset.relay;
    ring.dataset.flare = "";
    const willPass = !isTheme && s.myPack.length > 0 && s.counts.total < s.cardsPerPlayer;
    updateStatus(willPass ? `Everyone's in. Passing ${s.direction > 0 ? "left" : "right"}.` : isTheme ? "Everyone's in. Next round." : "Pack finished.");
    if (willPass) passAll(s);
    else if (isTheme) themeClear();
    else if (s.counts.total < s.cardsPerPlayer) botSay("gg", 0.7, 500);
  }

  function onComplete(s) {
    S.st = s;
    body.dataset.turn = "done";
    clearCards();
    hideHolo(false);
    updateDisk(s);
    renderBinder();
    setTimeout(() => showFinale(s), 700);
  }

  function showFinale(s) {
    const c = s.counts;
    $("finSub").textContent = isTheme
      ? `${s.mainDrafted} main deck cards and ${s.extraDrafted} for the Extra Deck, all ${s.theme.name}.`
      : `${c.total} cards drafted. Your deck starts here.`;
    $("finBar").innerHTML = KINDS.map((k) => `<i data-kind="${k}" style="--n:${c[k]}"></i>`).join("");
    $("finCounts").innerHTML = KINDS.map((k) => `<div data-kind="${k}"><b>${c[k]}</b><span><i></i>${Kit.KIND_LABEL[k]}</span></div>`).join("");
    const mon = s.pool.filter((p) => p.kind === "monster");
    const low = mon.filter((p) => (p.card.level || 0) <= 4).length;
    const clocked = s.pool.filter((p) => p.auto === "clock").length;
    $("finNote").textContent = `${low} of your ${mon.length} main deck monsters need no tribute.` + (clocked ? ` The clock picked ${clocked} for you.` : "");
    const fan = $("finFan");
    const picks = s.pool.filter((p) => p.auto !== "skip").slice(-7);
    const show = picks.length >= 5 ? picks : s.pool.slice(-7);
    fan.innerHTML = show.map((p) => `<img src="${p.card.img}" alt="">`).join("");
    const n = show.length;
    [...fan.children].forEach((img, i) => {
      const a = (i - (n - 1) / 2) * 9;
      img.style.transform = `rotate(${a}deg)`;
      Kit.animate(img, [{ transform: "rotate(0deg) translateY(30px)", opacity: 0 }, { transform: `rotate(${a}deg)`, opacity: 1 }], { duration: 520, delay: 300 + i * 60, easing: "cubic-bezier(0.16,1,0.3,1)", fill: "backwards" });
    });
    closeSheets();
    const f = $("finale");
    f.hidden = false;
    Kit.animate(f.querySelector(".fin-word"), [{ opacity: 0, transform: "scale(1.75)" }, { opacity: 1, transform: "scale(1)" }], { duration: 420, easing: "cubic-bezier(0.2,0.9,0.3,1)", fill: "backwards" });
    const others = sim.options.seats.slice(1);
    const lines = [[others[0], "gg"], [others[2], "gg"], [others[4], "nice pool"]];
    $("finChat").innerHTML = lines.map(([s, t]) => `<span class="bubble"><small>${esc(s.name)}</small>${t}</span>`).join("");
    [...$("finChat").children].forEach((b, i) => Kit.animate(b, [{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }], { duration: 260, delay: 900 + i * 380, fill: "backwards" }));
    $("buildBtn").focus();
  }
  $("buildBtn").addEventListener("click", () => {
    const fan = $("finFan");
    [...fan.children].forEach((img, i) => Kit.animate(img, [{}, { transform: "rotate(0deg) translateY(-6px)" }], { duration: 380, delay: i * 30, fill: "forwards", easing: "cubic-bezier(0.45,0,0.2,1)" }));
    $("finActions").innerHTML = `<p class="handoff">Opening the deck builder with your ${S.st.counts.total} cards. The editor takes over from here.</p><a class="btn-2" href="workshop.html">Back to the workshop</a>`;
  });

  /* ---------- the filter ---------- */
  const TIERS = [["low", "1–4", (l) => l >= 1 && l <= 4], ["mid", "5–6", (l) => l === 5 || l === 6], ["high", "7+", (l) => l >= 7]];
  const titleCase = (s) => s.charAt(0) + s.slice(1).toLowerCase();
  function typeKey(card, kind) {
    if (!card.race) return null;
    if (kind === "spell") return "spell:" + card.race;
    if (kind === "trap") return "trap:" + card.race;
    return "monster:" + card.race;
  }
  function hay(card, kind) {
    if (!card._hay) card._hay = [card.name, card.desc, card.race, card.arch, card.attr, card.type, Kit.KIND_ONE[kind], ...Kit.typeParts(card)].filter(Boolean).join(" ").toLowerCase();
    return card._hay;
  }
  const filtering = () => F.kinds.size || F.q || F.lvl.size || F.type.size || F.attr.size || F.arch.size;
  function matches(card, kind) {
    if (F.kinds.size && !F.kinds.has(kind)) return false;
    if (F.q) {
      const h = hay(card, kind);
      if (!F.q.split(/\s+/).every((w) => h.includes(w))) return false;
    }
    if (F.lvl.size) {
      if (kind !== "monster") return false;
      if (!TIERS.some(([k, , t]) => F.lvl.has(k) && t(card.level || 0))) return false;
    }
    if (F.type.size && !F.type.has(typeKey(card, kind))) return false;
    if (F.attr.size && !F.attr.has(card.attr)) return false;
    if (F.arch.size && !F.arch.has(card.arch)) return false;
    return true;
  }
  function filterWords() {
    const parts = [];
    if (F.kinds.size) parts.push([...F.kinds].map((k) => Kit.KIND_LABEL[k]).join(" or "));
    if (F.lvl.size) parts.push("Level " + [...F.lvl].map((k) => TIERS.find((t) => t[0] === k)[1]).join(" or "));
    if (F.type.size) parts.push([...F.type].map((k) => k.split(":")[1] + (k.startsWith("spell") ? " Spell" : k.startsWith("trap") ? " Trap" : "")).join(" or "));
    if (F.attr.size) parts.push([...F.attr].map(titleCase).join(" or "));
    if (F.arch.size) parts.push([...F.arch].join(" or "));
    if (F.q) parts.push(`“${F.q}”`);
    return parts.join(", ");
  }
  function clearFilter() {
    F.kinds.clear(); F.lvl.clear(); F.type.clear(); F.attr.clear(); F.arch.clear();
    F.q = "";
    $("q").value = "";
    $("search").removeAttribute("data-has");
    refilter();
  }
  function refilter() {
    applyLens();
    renderBinder();
    syncSlots();
  }
  function syncSlots() {
    document.querySelectorAll(".slot").forEach((s) => s.setAttribute("aria-pressed", String(F.kinds.has(s.dataset.kind))));
  }
  function applyLens() {
    const on = filtering() && body.dataset.turn !== "done";
    let hits = 0, n = 0;
    S.els.forEach((el, uid) => {
      const d = dealt(uid);
      if (!d) return;
      n++;
      if (!on) { el.removeAttribute("data-lens"); return; }
      const ok = matches(d.card, d.kind);
      if (ok) hits++;
      el.dataset.lens = ok ? "hit" : "miss";
    });
    const lens = $("lens");
    lens.hidden = !on;
    if (on) $("lensText").innerHTML = n ? `<b>${hits} of ${n}</b> in this pack: ${esc(filterWords())}` : `Filter: ${esc(filterWords())}`;
  }
  $("lensClear").addEventListener("click", clearFilter);

  /* ---------- the binder ---------- */
  function listFor(tab) {
    if (tab === "gone") return S.gone.map((d) => Object.assign({}, d, { src: "gone" }));
    return S.st.pool.map((p) => Object.assign({}, p, { src: "mine" }));
  }
  function setTab(t) {
    S.tab = t;
    S.open.clear();
    $("tabMine").setAttribute("aria-selected", String(t === "mine"));
    $("tabGone").setAttribute("aria-selected", String(t === "gone"));
    $("list").setAttribute("aria-labelledby", t === "mine" ? "tabMine" : "tabGone");
    $("bdScroll").scrollTop = 0;
    renderBinder();
  }
  $("tabMine").addEventListener("click", () => setTab("mine"));
  $("tabGone").addEventListener("click", () => setTab("gone"));

  function countBy(list, keyFn) {
    const m = new Map();
    list.forEach((e) => {
      const k = keyFn(e);
      if (k == null || k === "") return;
      m.set(k, (m.get(k) || 0) + 1);
    });
    return m;
  }

  function renderFacets(list) {
    const pack = S.st.myPack || [];
    const all = list.concat(pack.map((d) => Object.assign({}, d, { src: "pack" })));
    const chipRow = (label, group, keyFn, opts) => {
      const counts = countBy(list, keyFn);
      const keys = new Set([...counts.keys(), ...countBy(all, keyFn).keys()]);
      F[group].forEach((k) => { if (!opts || !opts.prefix || String(k).startsWith(opts.prefix)) keys.add(k); });
      if (!keys.size) return "";
      let arr = [...keys].sort((a, b) => (counts.get(b) || 0) - (counts.get(a) || 0) || String(a).localeCompare(String(b)));
      if (opts && opts.limit) arr = arr.slice(0, opts.limit);
      return `<div class="fg"><span>${label}</span><div class="chips">${arr.map((k) => {
        const n = counts.get(k) || 0;
        const name = opts && opts.name ? opts.name(k) : k;
        const dot = opts && opts.dot ? `<i style="--dot:${opts.dot(k)}"></i>` : "";
        return `<button type="button" class="chip" data-g="${group}" data-k="${esc(k)}" aria-pressed="${F[group].has(k)}"${n ? "" : " data-zero"}>${dot}${esc(name)} <b>${n}</b></button>`;
      }).join("")}</div></div>`;
    };
    const race = (kinds) => (e) => (kinds.includes(e.kind) ? typeKey(e.card, e.kind) : null);
    return chipRow("Monster type", "type", race(["monster", "extra"]), { name: (k) => k.split(":")[1], prefix: "monster:" }) +
      chipRow("Attribute", "attr", (e) => e.card.attr, { name: titleCase, dot: (k) => Kit.tint({ frame: "normal", attr: k }).main }) +
      chipRow("Spells", "type", race(["spell"]), { name: (k) => k.split(":")[1], prefix: "spell:" }) +
      chipRow("Traps", "type", race(["trap"]), { name: (k) => k.split(":")[1], prefix: "trap:" }) +
      chipRow("Archetype", "arch", (e) => e.card.arch, { limit: 8 });
  }

  // monster levels: one bar per star level for main deck monsters, grouped by what a summon costs.
  // Xyz ranks and Link ratings aren't levels, so the extra deck is counted by kind instead.
  const BANDS = [["low", "No tribute", 1, 4], ["mid", "1 tribute", 5, 6], ["high", "2 tributes", 7, 12]];
  const EX_KINDS = [["fusion", "Fusion"], ["synchro", "Synchro"], ["xyz", "Xyz"], ["link", "Link"]];
  function renderLevels(list) {
    const mons = list.filter((e) => e.kind === "monster");
    const ex = list.filter((e) => e.kind === "extra");
    if (!mons.length && !ex.length) return `<p class="lv-empty">Monster levels show here once you pick a monster.</p>`;
    const by = new Array(13).fill(0);
    mons.forEach((e) => { const l = Math.min(12, e.card.level || 0); if (l >= 1) by[l]++; });
    const max = Math.max(1, ...by);
    const bands = BANDS.map(([k, label, lo, hi]) => {
      let n = 0, bars = "";
      for (let l = lo; l <= hi; l++) {
        n += by[l];
        bars += `<span class="lb" style="--h:${by[l] / max}"${by[l] ? "" : " data-zero"}><span class="lbx"><i></i><b>${by[l] || ""}</b></span><small>${l}</small></span>`;
      }
      return `<button type="button" data-g="lvl" data-k="${k}" aria-pressed="${F.lvl.has(k)}" aria-label="${label}, level ${lo} to ${hi}: ${n} monster${n === 1 ? "" : "s"}" style="--cols:${hi - lo + 1}"><span class="lbars" aria-hidden="true">${bars}</span><span class="lt">${label} <b>${n}</b></span></button>`;
    }).join("");
    const exN = EX_KINDS.map(([f, name]) => [name, ex.filter((e) => (e.card.frame || "").startsWith(f)).length]).filter(([, n]) => n);
    const exLine = exN.length ? `<p class="lv-ex"><span>Extra deck</span>${exN.map(([name, n]) => `<span>${name} <b>${n}</b></span>`).join("")}</p>` : "";
    return `<div class="lv-h"><span>Monster levels</span><small>Main deck, by stars</small></div><div class="lv-chart">${bands}</div>${exLine}`;
  }

  function rowHtml(group, i) {
    const e = group[0];
    const c = e.card;
    const key = `${S.tab}:${c.id}:${i}`;
    const open = S.open.has(key);
    const sp = Kit.statParts(c);
    const kindLine = Kit.typeParts(c).filter((p, j) => j !== 0 || e.kind === "spell" || e.kind === "trap").join(", ");
    let right;
    if (S.order === "pick" && S.tab === "mine") {
      right = `<span class="rs"><span class="no">${isTheme ? "Round " + (e.phase === "extra" ? e.round - sim.options.cardsPerPlayer : e.round) : "Pick " + e.step}</span>${e.auto === "clock" ? `<em class="clockpick">Clock pick</em>` : ""}</span>`;
    } else if (S.tab === "gone") {
      right = `<span class="rs"><span class="no">Pack ${e.pack}</span><em>by pick ${e.goneBy}</em></span>`;
    } else {
      right = `<span class="rs">${group.length > 1 ? `<span class="x2">×${group.length}</span>` : sp ? sp.map((x) => x[1]).join(" / ") : ""}${group.length > 1 && sp ? `<em>${sp.map((x) => x[1]).join(" / ")}</em>` : ""}</span>`;
    }
    const isNew = S.tab === "mine" && group.some((g) => g.uid === S.newUid);
    return `<li${isNew ? " data-new" : ""}><button type="button" class="row-btn" data-key="${key}" data-uid="${e.uid}" aria-expanded="${open}"><img src="${c.img}" alt="" loading="lazy"><span class="rn">${esc(c.name)}</span><span class="rt">${esc(kindLine)}</span>${right}</button>${open ? `<div class="rd">${esc(Kit.desc(c))}</div>` : ""}</li>`;
  }

  function sortKey(e) {
    const c = e.card;
    if (e.kind === "monster" || e.kind === "extra") return [-(c.level || c.link || 0), c.name];
    return [c.race || "", c.name];
  }
  function cmp(a, b) {
    const x = sortKey(a), y = sortKey(b);
    return x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : x[1].localeCompare(y[1]);
  }

  function renderBinder(flash) {
    const list = listFor(S.tab);
    const mine = S.st.pool;
    $("tabMineN").textContent = mine.length;
    $("tabGoneN").textContent = S.gone.length;
    // kind chips and mix bar describe the whole list; the list below shows what matches
    const kc = { monster: 0, spell: 0, trap: 0, extra: 0 };
    list.forEach((e) => kc[e.kind]++);
    $("mixBar").innerHTML = list.length
      ? KINDS.map((k) => `<i data-kind="${k}" style="--n:${kc[k]}"></i>`).join("")
      : `<i class="rest" style="--n:1"></i>`;
    $("levels").innerHTML = renderLevels(list);
    $("kinds").innerHTML = KINDS.map((k) => `<button type="button" data-kind="${k}" data-g="kinds" data-k="${k}" aria-pressed="${F.kinds.has(k)}"><b>${kc[k]}</b><small><i></i>${Kit.KIND_LABEL[k]}</small></button>`).join("");
    const facets = $("facets");
    const openFacets = $("moreBtn").getAttribute("aria-expanded") === "true";
    facets.hidden = !openFacets;
    if (openFacets) facets.innerHTML = renderFacets(list);
    const active = F.lvl.size + F.type.size + F.attr.size + F.arch.size;
    $("moreHint").textContent = !openFacets && active ? `${active} on` : "";

    const shown = list.filter((e) => matches(e.card, e.kind));
    $("showing").innerHTML = filtering()
      ? `Showing ${shown.length} of ${list.length} <button type="button" id="showClear">Clear</button>`
      : S.tab === "gone" ? `${list.length} cards gone` : `${list.length} of ${isTheme ? sim.options.cardsPerPlayer + sim.options.extraDeckSize : sim.options.cardsPerPlayer} picked`;
    const sc = $("showClear");
    if (sc) sc.addEventListener("click", clearFilter);
    document.querySelectorAll("#orderSeg button").forEach((b) => {
      b.setAttribute("aria-pressed", String(b.dataset.order === S.order));
      b.disabled = S.tab === "gone";
    });

    const L = $("list");
    const scroller = $("bdScroll");
    const keep = scroller.scrollTop;
    L.dataset.tab = S.tab;
    let html = "";
    if (!list.length) {
      html = S.tab === "gone"
        ? `<p class="empty">Nothing yet. When a pack you've already seen comes back around, the cards your friends took from it show up here.</p>`
        : `<p class="empty">Your picks land here as you draft.</p>`;
    } else if (!shown.length) {
      html = `<p class="empty">Nothing here matches ${esc(filterWords())}. <button type="button" id="emptyClear">Clear the filter</button></p>`;
    } else if (S.order === "pick" && S.tab === "mine") {
      const groups = new Map();
      shown.forEach((e) => {
        const k = isTheme ? (e.phase === "extra" ? "Extra deck" : "Main deck") : `Pack ${e.pack}`;
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(e);
      });
      groups.forEach((g, k) => {
        html += `<h4>${k}<span>${g.length}</span></h4><ul>${g.map((e, i) => rowHtml([e], k + i)).join("")}</ul>`;
      });
    } else {
      KINDS.forEach((k) => {
        const g = shown.filter((e) => e.kind === k).sort(cmp);
        if (!g.length) return;
        // copies of the same card share a row
        const byId = new Map();
        g.forEach((e) => {
          if (S.tab === "gone") return byId.set(e.uid, [e]);
          if (!byId.has(e.card.id)) byId.set(e.card.id, []);
          byId.get(e.card.id).push(e);
        });
        html += `<h4 data-kind="${k}"><i></i>${Kit.KIND_LABEL[k]}<span>${g.length}</span></h4><ul>${[...byId.values()].map((grp, i) => rowHtml(grp, i)).join("")}</ul>`;
      });
    }
    L.innerHTML = html;
    scroller.scrollTop = keep;
    const ec = $("emptyClear");
    if (ec) ec.addEventListener("click", clearFilter);
    if (flash && !Kit.reduced()) {
      const row = L.querySelector("li[data-new] > .row-btn");
      if (row) {
        row.classList.add("flash");
        if (binderOpen() && !phoneMq.matches) row.scrollIntoView({ block: "nearest" });
      }
    }
  }

  // chips and kind buttons share one handler
  $("binder").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-g]");
    if (b) {
      const set = F[b.dataset.g];
      const k = b.dataset.k;
      set.has(k) ? set.delete(k) : set.add(k);
      const g = b.dataset.g;
      refilter();
      const again = $("binder").querySelector(`button[data-g="${g}"][data-k="${CSS.escape(k)}"]`);
      if (again) again.focus({ preventScroll: true });
      return;
    }
    const row = e.target.closest(".row-btn");
    if (row) {
      const k = row.dataset.key;
      S.open.has(k) ? S.open.delete(k) : S.open.add(k);
      renderBinder();
      const again = $("list").querySelector(`.row-btn[data-key="${CSS.escape(k)}"]`);
      if (again) again.focus({ preventScroll: true });
    }
  });
  // reading a pick in the reader on hover
  if (hoverable) {
    $("list").addEventListener("pointerover", (e) => {
      const row = e.target.closest(".row-btn");
      if (!row) return;
      const uid = row.dataset.uid;
      const entry = S.tab === "mine" ? S.st.pool.find((p) => p.uid === uid) : S.gone.find((p) => p.uid === uid);
      if (!entry) return;
      S.peek = { card: entry.card, tag: S.tab === "mine" ? readerTag(entry) : `Gone from pack ${entry.pack} by pick ${entry.goneBy}` };
      renderInsp();
    });
    $("list").addEventListener("pointerleave", () => { S.peek = null; renderInsp(); });
  }
  $("orderSeg").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-order]");
    if (!b) return;
    S.order = b.dataset.order;
    S.open.clear();
    renderBinder();
  });
  $("moreBtn").addEventListener("click", () => {
    const b = $("moreBtn");
    b.setAttribute("aria-expanded", String(b.getAttribute("aria-expanded") !== "true"));
    renderBinder();
  });
  $("bdX").addEventListener("click", closeSheets);

  // search: typing never reaches the pick keys
  const q = $("q");
  let qt;
  q.addEventListener("input", () => {
    clearTimeout(qt);
    $("search").toggleAttribute("data-has", !!q.value);
    qt = setTimeout(() => {
      F.q = q.value.trim().toLowerCase();
      refilter();
    }, 90);
  });
  q.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      if (q.value) { q.value = ""; F.q = ""; $("search").removeAttribute("data-has"); refilter(); }
      else q.blur();
    }
  });
  $("qClear").addEventListener("click", (e) => {
    e.preventDefault();
    q.value = "";
    F.q = "";
    $("search").removeAttribute("data-has");
    refilter();
    q.focus();
  });

  /* ---------- the disk opens and filters ---------- */
  $("dial").addEventListener("click", () => {
    if (phoneMq.matches || drawerMq.matches) {
      if (binderOpen()) closeSheets();
      else { setTab("mine"); openSheet("binder"); }
    } else q.focus();
  });
  document.querySelectorAll(".slot").forEach((slot) => {
    slot.addEventListener("click", () => {
      const k = slot.dataset.kind;
      F.kinds.has(k) ? F.kinds.delete(k) : F.kinds.add(k);
      refilter();
      // where the binder is hidden, a count opens it already filtered
      if ((phoneMq.matches || drawerMq.matches) && F.kinds.has(k) && !binderOpen()) { setTab("mine"); openSheet("binder"); }
    });
  });

  /* ---------- popovers: animations and reactions ---------- */
  const NOTES = {
    full: "Holograms, table lights and card movement.",
    calm: "Cards still move when you pick and pass. No looping effects.",
    off: "Nothing moves. Changes happen instantly.",
  };
  function syncMotion(level) {
    document.querySelectorAll("#motionSeg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.motion === level)));
    $("motionNote").textContent = NOTES[level];
    $("motionBtn").setAttribute("aria-label", `Animations: ${level === "full" ? "Full" : level === "calm" ? "Calm" : "Off"}`);
  }
  $("motionSeg").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-motion]");
    if (b) Kit.setMotion(b.dataset.motion);
  });
  Kit.onMotion(syncMotion);

  let popOpen = null, popBtn = null;
  function togglePop(which, btn) {
    const pop = $(which === "motion" ? "motionPop" : "sayPop");
    if (popOpen === pop) return closePop();
    closePop();
    pop.hidden = false;
    popOpen = pop;
    popBtn = btn;
    btn.setAttribute("aria-expanded", "true");
    const r = btn.getBoundingClientRect();
    const w = pop.offsetWidth, h = pop.offsetHeight;
    const below = r.bottom + 8 + h < innerHeight;
    pop.style.top = (below ? r.bottom + 8 : r.top - 8 - h) + "px";
    pop.style.left = Math.max(10, Math.min(innerWidth - w - 10, r.right - w)) + "px";
    const first = pop.querySelector('button[aria-pressed="true"]') || pop.querySelector("button");
    if (first) first.focus();
  }
  function closePop() {
    if (!popOpen) return;
    popOpen.hidden = true;
    if (popBtn) { popBtn.setAttribute("aria-expanded", "false"); }
    popOpen = null;
    popBtn = null;
  }
  $("motionBtn").addEventListener("click", (e) => togglePop("motion", e.currentTarget));
  $("sayBtn").addEventListener("click", (e) => togglePop("say", e.currentTarget));
  addEventListener("pointerdown", (e) => {
    if (popOpen && !popOpen.contains(e.target) && !(popBtn && popBtn.contains(e.target))) closePop();
  });

  /* ---------- reactions: a few words to the table ---------- */
  const PHRASES = ["gg", "lol", "nice", "hurry up", "no way", "gl"];
  $("says").innerHTML = PHRASES.map((p) => `<button type="button" data-say="${p}">${p}</button>`).join("");
  $("says").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-say]");
    if (!b) return;
    bubble(0, b.dataset.say);
    closePop();
    // someone usually answers
    const reply = { gg: "gg", lol: "lol", nice: "lol", "hurry up": "lol", "no way": "lol", gl: "gl" }[b.dataset.say];
    botSay(reply, 0.8, 1100);
  });
  function seatPoint(i) {
    const sr = document.body.getBoundingClientRect();
    if (i === 0) {
      const r = $("dial").getBoundingClientRect();
      return { x: r.left + 30 - sr.left, y: r.top - 6 };
    }
    const el = phoneMq.matches ? document.querySelector(`.chip-seat[data-seat="${i}"] .av`) : document.querySelector(`.seat[data-seat="${i}"] .av`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (phoneMq.matches) return { x: r.left + r.width / 2 - 4, y: $("strip").getBoundingClientRect().bottom + 4, up: true };
    return { x: r.left + 8, xr: r.right - 8, y: r.top - 6 };
  }
  const talking = new Map();
  function bubble(i, text) {
    if (!$("finale").hidden) return;
    // on a phone a friend's line takes the place of their name in the strip, so it never covers the table notes
    if (phoneMq.matches && i !== 0) {
      const chip = document.querySelector(`.chip-seat[data-seat="${i}"]`);
      if (!chip) return;
      let say = chip.querySelector(".say");
      if (!say) {
        say = document.createElement("span");
        say.className = "say";
        say.setAttribute("role", "status");
        chip.appendChild(say);
      }
      say.textContent = text;
      chip.dataset.talk = "";
      clearTimeout(say._t);
      Kit.animate(say, [{ opacity: 0, transform: "scale(0.8)" }, { opacity: 1, transform: "none" }], { duration: 200, easing: "cubic-bezier(0.2,0.9,0.3,1.2)" });
      say._t = setTimeout(() => delete chip.dataset.talk, 2600);
      return;
    }
    const p = seatPoint(i);
    if (!p) return;
    const old = talking.get(i);
    if (old) old.remove();
    if (phoneMq.matches) talking.forEach((o, k) => { o.remove(); talking.delete(k); });
    const b = document.createElement("div");
    const flip = !p.up && p.x + 170 > stage.getBoundingClientRect().right;
    if (flip) p.x = p.xr;
    b.className = p.up ? "bubble up" : flip ? "bubble flip" : "bubble";
    b.setAttribute("role", "status");
    b.innerHTML = i === 0 ? esc(text) : `<small>${esc(sim.options.seats[i].name)}</small>${esc(text)}`;
    b.style.left = (flip ? p.x : Math.min(innerWidth - 150, Math.max(8, p.x))) + "px";
    b.style.top = p.y + "px";
    document.body.appendChild(b);
    talking.set(i, b);
    Kit.animate(b, [{ opacity: 0, transform: `translateY(${p.up ? -6 : 6}px) scale(0.9)` }, { opacity: 1, transform: "none" }], { duration: 220, easing: "cubic-bezier(0.2,0.9,0.3,1.2)" });
    setTimeout(() => {
      Kit.animate(b, [{ opacity: 1 }, { opacity: 0 }], { duration: 260 }).then(() => {
        b.remove();
        if (talking.get(i) === b) talking.delete(i);
      });
    }, 2600);
  }
  let lastBot = -Infinity;
  // friends' lines in the mock come from simple triggers; in the real room each line is a person
  function botSay(text, chance, delay) {
    if (Math.random() > chance) return;
    const now = performance.now();
    if (now - lastBot < 3500) return;
    lastBot = now;
    const who = 1 + Math.floor(Math.random() * (N - 1));
    setTimeout(() => bubble(who, text), delay || 400);
  }
  function maybeReactToPick(entry) {
    if (entry.auto === "clock") return botSay("lol", 0.9, 500);
    const c = entry.card;
    if ((c.atk || 0) >= 3000 || c.frame === "link") botSay(Math.random() < 0.5 ? "nice" : "no way", 0.45, 700);
  }
  // someone gets impatient when the table waits on one person
  let nagged = -1;
  function nag() {
    if (body.dataset.turn !== "waiting") return;
    const left = sim.remaining() / 1000;
    const slow = S.st.seats.filter((s) => !s.isMe && !s.hasPicked);
    if (slow.length === 1 && left < sim.options.pickSeconds - 14 && nagged !== S.st.step + S.st.pack * 100) {
      nagged = S.st.step + S.st.pack * 100;
      const who = S.st.seats.find((s) => !s.isMe && s.hasPicked);
      if (who) setTimeout(() => bubble(who.seatIndex, "hurry up"), 200);
    }
  }
  setInterval(nag, 1000);

  /* ---------- clock ---------- */
  function frame() {
    const rem = sim.remaining();
    const secs = Math.ceil(rem / 1000);
    const turn = body.dataset.turn;
    // with animations off the line steps once a second
    const frac = Math.max(0, Math.min(1, (Kit.reduced() ? secs * 1000 : rem) / (sim.options.pickSeconds * 1000)));
    drawRing(frac, turn);
    if (secs !== S.lastSecs) {
      S.lastSecs = secs;
      $("clock").textContent = Kit.fmtClock(rem);
    }
    // gold, then red, only while it's your turn
    const urg = turn !== "picking" ? "" : secs <= 5 ? "out" : secs <= 10 ? "low" : "";
    if ((body.dataset.urgency || "") !== urg) body.dataset.urgency = urg;
    requestAnimationFrame(frame);
  }

  /* ---------- keys ---------- */
  const inField = (t) => t && t.closest && t.closest("input, textarea, select");
  addEventListener("keydown", (e) => {
    if (inField(e.target)) return;
    if (/^[1-9]$|^Arrow/.test(e.key)) body.dataset.kbd = "";
    if (e.key === "/" && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      if (phoneMq.matches || drawerMq.matches) openSheet("binder");
      q.focus({ preventScroll: true });
    }
  });
  addEventListener("pointerdown", () => { delete body.dataset.kbd; });
  function packOrder() { return S.st.myPack.filter((d) => S.els.has(d.uid)).map((d) => d.uid); }
  Kit.keys({
    index(i) { const o = packOrder(); if (o[i]) select(o[i], false); },
    move(dir) {
      const o = packOrder();
      if (!o.length) return;
      let i = Math.max(0, o.indexOf(S.sel));
      const cols = o.length <= 4 ? o.length : S.G.cols;
      if (S.sel == null) i = 0;
      else if (dir === "left") i = Math.max(0, i - 1);
      else if (dir === "right") i = Math.min(o.length - 1, i + 1);
      else if (dir === "up") i = Math.max(0, i - cols);
      else if (dir === "down") i = Math.min(o.length - 1, i + cols);
      select(o[i], false);
    },
    pick() { if (S.sel) doPick(S.sel); },
    escape() {
      if (popOpen) { const b = popBtn; closePop(); if (b) b.focus(); return; }
      if (body.dataset.sheet === "binder" || "binder" in body.dataset) return closeSheets();
      closeSheets();
      select(null);
    },
  });

  /* ---------- wire up ---------- */
  sim.on("step", onStep);
  sim.on("pick", onPick);
  sim.on("seat", (e) => {
    S.st.seats = e.seats;
    setSeat(e.seatIndex, true, e.auto);
    if (!Kit.calm()) document.querySelectorAll(`.seat[data-seat="${e.seatIndex}"] .av, .chip-seat[data-seat="${e.seatIndex}"] .av`).forEach((a) => Kit.animate(a, [{ transform: "none" }, { transform: "translateY(-3px) scale(1.1)" }, { transform: "none" }], { duration: 380, easing: "ease-out" }));
    updateStatus();
    if (!myTurn()) renderInsp();
    if (e.auto) botSay("lol", 0.7, 300);
  });
  sim.on("settle", onSettle);
  sim.on("complete", onComplete);
  sim.on("jump", () => { S.jumped = true; S.seen = []; });

  let rz;
  addEventListener("resize", () => {
    clearTimeout(rz);
    closePop();
    rz = setTimeout(() => {
      layoutAll(false);
      const el = S.sel && S.els.get(S.sel);
      if (el && !S.G.phone) showHolo(dealt(S.sel).card, el);
      else hideHolo(false);
    }, 120);
  });

  // dust drifting through the lamp light
  $("dust").innerHTML = Array.from({ length: 14 }, () => {
    const r = Math.random;
    return `<i style="left:${(r() * 100).toFixed(1)}%;top:${(r() * 80).toFixed(1)}%;--s:${(1.4 + r() * 1.8).toFixed(1)}px;--o:${(0.2 + r() * 0.45).toFixed(2)};--t:${(11 + r() * 10).toFixed(1)}s;--dl:${(-r() * 20).toFixed(1)}s;--dx:${Math.round(r() * 60 - 30)}px;--dy:${Math.round(r() * 80 - 25)}px"></i>`;
  }).join("");
  // the lamp catches a card now and then while you choose
  function glint() {
    setTimeout(glint, 2400 + Math.random() * 2600);
    if (Kit.calm() || !myTurn() || document.hidden) return;
    const pool = [...cardsEl.children].filter((el) => !el.classList.contains("gone") && !el.hasAttribute("data-sel") && el.dataset.lens !== "miss");
    const el = pool[Math.floor(Math.random() * pool.length)];
    if (!el) return;
    el.setAttribute("data-glint", "");
    setTimeout(() => el.removeAttribute("data-glint"), 1200);
  }
  setTimeout(glint, 2500);

  if (phoneMq.matches) $("moreBtn").setAttribute("aria-expanded", "false");
  buildSeats();
  measure();
  layoutAll(false);
  updateDisk(S.st);
  syncMotion(Kit.motion());
  renderBinder();
  renderInsp();
  Kit.demo(sim);
  requestAnimationFrame(frame);
  (document.fonts ? document.fonts.ready : Promise.resolve()).then(() => {
    sim.start();
    Kit.autoJump(sim);
  });
  // screenshot hooks
  window.__sim = sim;
  window.__room = { F, refilter, setTab, openSheet, clearFilter, togglePop, bubble, S };
})();
