/* Cube night's copy of the mock helpers (kit.js stays as B and C use it). Differences: motion has
   three levels (full, calm, off) set from the room itself, and animate/flight do nothing when it is off.
   Small helpers shared by the three mocks: config from the URL, card text, attribute light
   colours (the duel's attack tints), card flights, keys, reduced motion and the mock-controls panel.
   The mock-controls panel is not part of any design. */
(function (global) {
  "use strict";

  const params = new URLSearchParams(location.search);
  const root = document.documentElement;

  /* ---------- motion: a room setting with three levels ----------
     full: everything, including looping light effects.
     calm: cards still move when you pick and when packs pass; nothing loops.
     off:  nothing moves; changes happen at once.
     The choice is remembered on this device. Until someone chooses, the device's
     reduce-motion setting decides (reduce means off). ?motion=full|calm|off wins for screenshots. */
  const mq = matchMedia("(prefers-reduced-motion: reduce)");
  const KEY = "cube-night-motion";
  const LEVELS = ["full", "calm", "off"];
  const motionListeners = new Set();
  function stored() {
    try {
      const v = localStorage.getItem(KEY);
      return LEVELS.includes(v) ? v : null;
    } catch (e) {
      return null;
    }
  }
  function initialMotion() {
    const forced = params.get("motion");
    if (forced === "reduced") return "off";
    if (LEVELS.includes(forced)) return forced;
    return stored() || (mq.matches ? "off" : "full");
  }
  root.dataset.motion = initialMotion();
  mq.addEventListener("change", () => {
    if (params.get("motion") || stored()) return;
    setMotion(mq.matches ? "off" : "full", false);
  });
  function setMotion(level, remember) {
    if (!LEVELS.includes(level)) return;
    root.dataset.motion = level;
    if (remember !== false) {
      try {
        localStorage.setItem(KEY, level);
      } catch (e) {
        /* private window: the choice lasts for this visit */
      }
    }
    motionListeners.forEach((fn) => fn(level));
  }
  const motion = () => root.dataset.motion;
  const reduced = () => root.dataset.motion === "off";
  const calm = () => root.dataset.motion !== "full";
  const onMotion = (fn) => motionListeners.add(fn);

  /* ---------- seats, theme, sim options ---------- */
  const SEATS = [
    { name: "Imran" },
    { name: "Kestrel" },
    { name: "Marik_Mains" },
    { name: "voidpriest" },
    { name: "duel.josh" },
    { name: "BlueEyesBen" },
  ];
  const THEME_IDS = new Set([24915933, 41373230, 34848821, 68468459]);
  const THEME_ARCH = new Set(["Branded", "Despia", "Albaz Dragon"]);

  function cards() {
    return (global.CARDS || []).filter((c) => c.frame !== "token" && c.frame !== "skill");
  }
  function themePool() {
    const all = cards().filter((c) => THEME_ARCH.has(c.arch) || THEME_IDS.has(c.id));
    return {
      name: "Branded Despia",
      main: all.filter((c) => global.DraftSim.kindOf(c) !== "extra"),
      extra: all.filter((c) => global.DraftSim.kindOf(c) === "extra"),
    };
  }
  function simOptions(extra) {
    const mode = params.get("mode") === "theme" ? "theme" : "booster";
    return Object.assign(
      {
        mode,
        seats: SEATS,
        cards: cards(),
        theme: themePool(),
        pickSeconds: Number(params.get("clock")) || 45,
        pace: params.get("pace") === "holdout" ? "holdout" : "normal",
        seed: Number(params.get("seed")) || 11,
      },
      extra || {},
    );
  }

  /* ---------- card text ---------- */
  const kindOf = (c) => global.DraftSim.kindOf(c);
  const KIND_LABEL = { monster: "Monsters", spell: "Spells", trap: "Traps", extra: "Extra deck" };
  const KIND_ONE = { monster: "Monster", spell: "Spell", trap: "Trap", extra: "Extra deck" };

  function typeParts(c) {
    const k = kindOf(c);
    if (k === "spell" || k === "trap") {
      const sub = c.race && c.race !== "Normal" ? c.race + " " : "Normal ";
      return [sub + (k === "spell" ? "Spell" : "Trap")];
    }
    const parts = [c.type.replace(/ Card$/, "")];
    if (c.attr) parts.push(c.attr);
    if (c.race) parts.push(c.race);
    if (c.frame === "link" && c.link) parts.push("Link " + c.link);
    else if (c.frame === "xyz" && c.level) parts.push("Rank " + c.level);
    else if (c.level) parts.push("Level " + c.level);
    return parts;
  }
  const stat = (v) => (v == null ? "" : v < 0 ? "?" : String(v));
  function statParts(c) {
    const k = kindOf(c);
    if (k === "spell" || k === "trap") return null;
    if (c.frame === "link") return [["ATK", stat(c.atk)]];
    return [
      ["ATK", stat(c.atk)],
      ["DEF", stat(c.def)],
    ];
  }
  const desc = (c) => (c.desc || "").replace(/\r\n/g, "\n");

  /* Light colours by attribute: the duel's attack tints (attack-styles.ts). Spells and traps take the
     house card-kind colours. Each value is an "r g b" triplet for rgb(var(--x) / a). */
  const TINT = {
    EARTH: ["255 241 214", "226 168 96", "138 90 34"],
    WATER: ["234 250 255", "95 192 255", "26 79 156"],
    FIRE: ["255 243 208", "255 122 58", "154 30 10"],
    WIND: ["240 255 244", "126 230 168", "31 122 74"],
    LIGHT: ["255 255 255", "255 224 138", "180 138 30"],
    DARK: ["243 234 255", "168 107 255", "61 26 134"],
    DIVINE: ["255 251 230", "255 210 74", "168 114 12"],
    spell: ["226 255 247", "82 195 169", "20 88 74"],
    trap: ["255 230 246", "214 132 189", "94 35 80"],
    none: ["255 244 220", "244 214 144", "107 84 32"],
  };
  function tint(c) {
    const k = kindOf(c);
    const t = TINT[k === "spell" || k === "trap" ? k : c.attr] || TINT.none;
    return { hi: t[0], main: t[1], deep: t[2] };
  }

  function fmtClock(ms) {
    const s = Math.ceil(ms / 1000);
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  }

  function names(list) {
    if (list.length === 0) return "";
    if (list.length === 1) return list[0];
    if (list.length === 2) return list[0] + " and " + list[1];
    return list.length + " players";
  }

  /* ---------- motion helpers ---------- */
  function animate(el, frames, opts) {
    if (!el || !el.animate || reduced()) return Promise.resolve();
    try {
      const a = el.animate(frames, opts);
      return a.finished.catch(() => {});
    } catch (e) {
      return Promise.resolve();
    }
  }
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  let layer = null;
  function fxLayer() {
    if (!layer) {
      layer = document.createElement("div");
      layer.className = "kit-fx";
      document.body.appendChild(layer);
    }
    return layer;
  }

  /* A ghost card flies from one rect to another (measure, then animate a ghost), like move-fx.tsx.
     Reduced motion: the ghost appears at the destination and fades. */
  function flight(o) {
    const from = o.from;
    const to = o.to;
    const el = document.createElement("div");
    el.className = "kit-ghost " + (o.className || "");
    el.style.width = from.width + "px";
    el.style.height = from.height + "px";
    if (o.src) el.style.backgroundImage = 'url("' + o.src + '")';
    if (o.glow) el.style.setProperty("--glow", o.glow);
    fxLayer().appendChild(el);
    const s = to.width / from.width;
    const sy = o.keepRatio ? s : to.height / from.height;
    const a = `translate(${from.left}px, ${from.top}px)`;
    const b = `translate(${to.left}px, ${to.top}px) scale(${s}, ${sy})`;
    let p;
    if (reduced()) {
      el.remove();
      return Promise.resolve();
    } else {
      const mx = (from.left + to.left) / 2;
      const my = Math.min(from.top, to.top) - (o.arc == null ? 90 : o.arc);
      const ms = (1 + s) / 2 + (o.swell || 0.12);
      const rot = o.rotate || 0;
      p = animate(
        el,
        [
          { transform: a + " rotate(0deg)", opacity: 1 },
          { transform: `translate(${mx}px, ${my}px) scale(${ms}) rotate(${rot / 2}deg)`, opacity: 1, offset: 0.45 },
          { transform: b + ` rotate(${rot}deg)`, opacity: o.fade === false ? 1 : 0.85 },
        ],
        { duration: o.duration || 620, easing: o.easing || "cubic-bezier(0.45, 0, 0.2, 1)", fill: "forwards" },
      );
    }
    return p.then(() => {
      el.remove();
    });
  }

  /* ---------- keys: 1-9 select, arrows move, Enter picks, Esc closes ---------- */
  function keys(map) {
    document.addEventListener("keydown", (e) => {
      if (e.target.closest && e.target.closest("input, select, textarea, .kit-demo")) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // an open dialog owns the keyboard; only Escape reaches the page
      const modal = [...document.querySelectorAll('[aria-modal="true"]')].some((m) => m.getClientRects().length);
      if (modal && e.key !== "Escape") return;
      if (/^[1-9]$/.test(e.key) && map.index) {
        map.index(Number(e.key) - 1);
        e.preventDefault();
      } else if (e.key.startsWith("Arrow") && map.move) {
        map.move(e.key.slice(5).toLowerCase());
        e.preventDefault();
      } else if (e.key === "Enter" && map.pick) {
        if (e.target.closest && e.target.closest("button:not([data-card])")) return;
        map.pick();
        e.preventDefault();
      } else if (e.key === "Escape" && map.escape) map.escape();
    });
  }

  /* ---------- mock-controls panel (not part of the design) ---------- */
  function demo(sim) {
    const mode = sim.options.mode;
    const url = (patch) => {
      const p = new URLSearchParams(location.search);
      Object.entries(patch).forEach(([k, v]) => (v == null ? p.delete(k) : p.set(k, v)));
      return location.pathname + "?" + p.toString();
    };
    const tab = document.createElement("button");
    tab.className = "kit-demo-tab";
    tab.type = "button";
    tab.textContent = "Mock controls";
    const panel = document.createElement("div");
    panel.className = "kit-demo";
    panel.hidden = true;
    const clock = String(sim.options.pickSeconds);
    const pace = sim.options.pace;
    panel.innerHTML = `
      <div class="kd-head"><b>Mock controls</b><button type="button" class="kd-x" aria-label="Close">×</button></div>
      <p class="kd-note">For trying the mock. Not part of the design.</p>
      <div class="kd-row"><span>Draft</span>
        <a href="${url({ mode: null, jump: null })}" aria-current="${mode === "booster"}">Cube draft</a>
        <a href="${url({ mode: "theme", jump: null })}" aria-current="${mode === "theme"}">Theme draft</a></div>
      <div class="kd-row"><span>Skip ahead</span>
        ${mode === "booster" ? '<button type="button" data-jump="late">End of this pack</button><button type="button" data-jump="nextPack">Next pack</button>' : '<button type="button" data-jump="extra">Extra deck phase</button>'}
        <button type="button" data-jump="finish">Finish the draft</button></div>
      <div class="kd-row"><span>Other players</span>
        <button type="button" data-pace="normal" aria-pressed="${pace === "normal"}">Quick</button>
        <button type="button" data-pace="holdout" aria-pressed="${pace === "holdout"}">One never picks</button></div>
      <div class="kd-row"><span>Pick clock</span>
        <a href="${url({ clock: null })}" aria-current="${clock === "45"}">45 s</a>
        <a href="${url({ clock: 15 })}" aria-current="${clock === "15"}">15 s</a></div>
      <div class="kd-row"><span>Motion (same as the room's own setting)</span>
        <button type="button" data-motion="full" aria-pressed="${motion() === "full"}">Full</button>
        <button type="button" data-motion="calm" aria-pressed="${motion() === "calm"}">Calm</button>
        <button type="button" data-motion="off" aria-pressed="${motion() === "off"}">Off</button></div>
      <div class="kd-row"><a class="kd-restart" href="${url({ jump: null })}">Restart</a></div>`;
    document.body.append(tab, panel);
    const toggle = (open) => {
      panel.hidden = !open;
      tab.setAttribute("aria-expanded", String(open));
    };
    tab.addEventListener("click", () => toggle(panel.hidden));
    panel.querySelector(".kd-x").addEventListener("click", () => toggle(false));
    panel.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      if (b.dataset.jump) {
        sim.jump(b.dataset.jump);
        toggle(false);
      }
      if (b.dataset.pace) {
        sim.setPace(b.dataset.pace);
        panel.querySelectorAll("[data-pace]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      }
      if (b.dataset.motion) setMotion(b.dataset.motion);
    });
    onMotion((level) => panel.querySelectorAll("[data-motion]").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.motion === level))));
  }

  /* URL hooks for screenshots: ?jump=late|nextPack|extra|finish runs once the draft starts. */
  function autoJump(sim) {
    const j = params.get("jump");
    if (j) setTimeout(() => sim.jump(j), Number(params.get("jumpAt")) || 300);
  }

  global.Kit = {
    params,
    reduced,
    calm,
    motion,
    setMotion,
    onMotion,
    simOptions,
    kindOf,
    KIND_LABEL,
    KIND_ONE,
    typeParts,
    statParts,
    desc,
    tint,
    fmtClock,
    names,
    animate,
    wait,
    flight,
    fxLayer,
    keys,
    demo,
    autoJump,
  };
})(window);
