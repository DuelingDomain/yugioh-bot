/* Layout presets. Each concept gives: chrome sizes, seat poses, then plate/chip placement after the boards are measured. */
(() => {
  "use strict";
  const K = window.KIT;
  const box = (a) => {
    const P = Object.values(a);
    const xs = P.map((p) => p.x), ys = P.map((p) => p.y);
    return { l: Math.min(...xs), r: Math.max(...xs), t: Math.min(...ys), b: Math.max(...ys), cx: (Math.min(...xs) + Math.max(...xs)) / 2, cy: (Math.min(...ys) + Math.max(...ys)) / 2 };
  };
  const bx = (ctx, seatEls, s) => box(ctx.anchors(seatEls[s].w));
  const pads = (M, seats) => seats.map((p) => ({ x: p.cx, y: p.cy, rgb: M.by[p.seat].T.rgb, rot: p.rot || 0, scale: p.padScale || p.z / 110 }));

  /* ============================================================ ORIGINAL
     Today's DuelTable: a 1100×860 stage scaled by min(W/1100, H/860) between a history/inspector pane and the
     Your Master pane. Poses are calibrated to today's 1920 shot (board centres in stage px). */
  const ORIG = {
    ffa4: { me: [550, 555], seats: { 1: { x: 167, y: 183, rot: 90, quarter: true }, 2: { x: 552, y: 119, rot: 180, tilt: 16 }, 3: { x: 933, y: 184, rot: 270, quarter: true } }, ring: [550, 300] },
    ffa3: { me: [550, 555], seats: { 1: { x: 300, y: 165, rot: 158, tilt: 12 }, 2: { x: 800, y: 165, rot: 202, tilt: 12 } }, ring: [550, 318] },
  };
  K.concepts.original = {
    chrome(S, u) {
      const harness = S.harness ? 26 : 0;
      return { top: 42 * u + harness, left: Math.round(S.vw / 3 - 140), right: Math.round(0.2 * S.vw - 76), bottom: 85 * u, harness };
    },
    layout(S, M, st) {
      const k = Math.min(st.w / 1100, st.h / 860);
      const ox = (st.w - 1100 * k) / 2, oy = (st.h - 860 * k) / 2;
      const X = (x) => ox + x * k, Y = (y) => oy + y * k;
      const G = ORIG[S.format === "ffa3" ? "ffa3" : "ffa4"];
      const zr = (S.format === "ffa3" ? 68 : 62) * k;
      const seats = [{ seat: 0, cx: X(G.me[0]), cy: Y(G.me[1]), z: 103.5 * k, mode: "full", guides: true }];
      Object.entries(G.seats).forEach(([s, g]) => seats.push({ seat: +s, cx: X(g.x), cy: Y(g.y), z: zr, mode: "full", rot: g.rot, tilt: g.tilt || 0, opp: true, quarter: g.quarter, persp: 1400 }));
      const L = { k, X, Y, seats, hand: { cw: 51.4 * k, cx: X(550), y: Y(750) }, ring: { x: X(G.ring[0]), y: Y(G.ring[1]), scale: 0.91 * k } };
      L.plaza = { cx: X(550), cy: Y(330), scale: k * 0.82, tilt: 58, persp: 1200, skyH: 130 * k, pads: pads(M, seats).map((p) => ({ ...p, scale: p.scale * 0.8 })) };
      return L;
    },
    place(S, M, st, L, ctx, seatEls) {
      const k = L.k, hk = 0.94 * k;
      const holo = {};
      const me = bx(ctx, seatEls, 0);
      holo[0] = { x: me.r + 10 * k, y: me.b + 1 * k, ay: "b", k: hk };
      if (S.format === "ffa3") {
        const a = bx(ctx, seatEls, 1), b = bx(ctx, seatEls, 2);
        holo[1] = { x: a.l + 4 * k, y: a.b + 14 * k, k: hk };
        holo[2] = { x: b.r - 4 * k, y: b.b + 14 * k, ax: "r", k: hk };
      } else {
        const w = bx(ctx, seatEls, 1), n = bx(ctx, seatEls, 2), e = bx(ctx, seatEls, 3);
        holo[1] = { x: w.l - 23 * k, y: w.b + 19 * k, k: hk };
        holo[2] = { x: n.l - 92 * k, y: n.b + 28 * k, k: hk };
        holo[3] = { x: e.r + 26 * k, y: e.b + 16 * k, ax: "r", k: hk };
      }
      return { holo, cam: { x: 18 * k, y: st.h - 14 * k, ay: "b" }, target: S.format === "ffa3" ? 2 : 3 };
    },
    chromeBuild(S, M, screen, st, ch, u, H) {
      if (ch.harness) {
        const hb = H.el("div", "", `position:absolute;left:0;right:0;top:0;height:26px;z-index:30;background:#05070d;border-bottom:1px solid rgb(255 255 255 / .06);color:#8f8a7e;font:11px/26px var(--f-ui);padding-left:12px;white-space:nowrap`, "4-way free-for-all &nbsp; main &nbsp; battle-aim &nbsp; chain-2 &nbsp; target-pick &nbsp; choose-opponent &nbsp; direct-attack &nbsp; elimination &nbsp; spectator &nbsp; result");
        screen.append(hb);
        screen.querySelector(".top").style.top = "26px";
      }
      screen.append(H.buildLeftPane(S, M, 0, st.y, ch.left, st.h));
      screen.append(H.buildRightPane(S, M, S.vw - ch.right, st.y, ch.right, st.h));
      screen.append(H.buildStrip(S, M, S.vh - ch.bottom, 25 * u));
      screen.append(H.buildTrack(S, M, 60 * u, false));
    },
  };

  /* shared chrome for the three concepts: 72px rail, overlay drawer, today's bottom bars (or merged) */
  function railChrome(S, u, merged) {
    return { top: 44 * u, left: 72 * u, right: 0, bottom: merged ? 74 * u : 85 * u };
  }
  function railBuild(S, M, screen, st, ch, u, H, merged) {
    screen.append(H.buildRail(S, M, 0, st.y, ch.left, st.h));
    if (S.panes === "drawer") screen.append(H.buildDrawer(S, M, ch.left, st.y, 380 * u, st.h));
    if (merged) screen.append(H.buildTrack(S, M, 74 * u, true));
    else {
      screen.append(H.buildStrip(S, M, S.vh - ch.bottom, 25 * u));
      screen.append(H.buildTrack(S, M, 60 * u, false));
    }
  }
  /** Push a plate out of any earlier box it hits, along y. */
  function settle(q, h, w, taken, dir = 1) {
    let guard = 0;
    const rectOf = () => {
      let x = q.x, y = q.y;
      if (q.ax === "r") x -= w;
      if (q.ax === "c") x -= w / 2;
      if (q.ay === "b") y -= h;
      return { l: x, r: x + w, t: y, b: y + h };
    };
    let r = rectOf();
    while (guard++ < 40 && taken.some((t) => t.l < r.r && r.l < t.r && t.t < r.b && r.t < t.b)) { q.y += dir * 6; r = rectOf(); }
    taken.push(r);
    return q;
  }
  /** First candidate whose box stays on the stage, off every other board and off earlier boxes. */
  function freeSpot(cands, h, w, taken, ctx, seatEls, st, own) {
    const rectOf = (q) => {
      let x = q.x, y = q.y;
      if (q.ax === "r") x -= w;
      if (q.ay === "b") y -= h;
      return { l: x, r: x + w, t: y, b: y + h };
    };
    const polys = Object.entries(seatEls).filter(([s]) => +s !== own).map(([, s]) => { const a = ctx.anchors(s.w); return [a.fl, a.fr, a.br, a.bl]; });
    const ok = (r) => r.l >= 4 && r.t >= 4 && r.r <= st.w - 4 && r.b <= st.h - 4
      && !taken.some((t) => t.l < r.r && r.l < t.r && t.t < r.b && r.t < t.b)
      && !polys.some((p) => K.polyRect(p, r, 2));
    const q = cands.find((c) => ok(rectOf(c))) || cands[0];
    taken.push(rectOf(q));
    return q;
  }

  /* ============================================================ WIDE PLAZA
     Same seats as today. The stage fills the width between a slim rail and the right edge; side rivals are
     about 1.6x today's width; plates dock below each rival's front corner; the seat strip joins the phase bar. */
  K.concepts.wide = {
    chrome: (S, u) => railChrome(S, u, true),
    layout(S, M, st, u) {
      const ffa3 = S.format === "ffa3";
      const pad = 12 * u, ringH = 126 * u;
      const nk = 0.74, tiltN = 20;
      // height budget: name margin + across (tilted) + ring + my board + hand
      const zH = (st.h - 2 * pad - ringH - 12 * u - 4 * u) / (0.26 * nk + 3.53 * nk * 0.95 + 3.53 + 0.78 * 1.0 + 0.04);
      const zW = (st.w - 2 * pad - 2 * 200 * u) / 5.98 * 0.78;
      const z = Math.min(zH, zW);
      const cx = st.w / 2;
      const seats = [];
      const nTop = pad + 0.26 * nk * z;
      const nH = 3.53 * nk * z * 0.95;
      const meTop = nTop + nH + ringH;
      const meH = 3.53 * z;
      seats.push({ seat: 0, cx, cy: meTop + meH / 2, z, mode: "full", guides: true });
      const ringY = nTop + nH + ringH / 2;
      if (ffa3) {
        const zr = Math.min(0.9 * z, (cx - 5.98 * z * 0.36 - 2 * pad) / 5.9);
        const yy = pad + 0.3 * zr + 3.53 * zr * 0.62;
        seats.push({ seat: 1, cx: cx - 2.85 * zr - 5.98 * z * 0.22, cy: yy + 0.5 * zr, z: zr, mode: "full", rot: 160, tilt: 14, opp: true, persp: 1600, handAt: "corner-l" });
        seats.push({ seat: 2, cx: cx + 2.85 * zr + 5.98 * z * 0.22, cy: yy + 0.5 * zr, z: zr, mode: "full", rot: 200, tilt: 14, opp: true, persp: 1600, handAt: "corner" });
      } else {
        seats.push({ seat: 2, cx, cy: nTop + nH / 2, z: nk * z, mode: "full", rot: 180, tilt: tiltN, opp: true, persp: 1500, handAt: "corner" });
        // sides: as large as the room beside my board allows, capped at .9 of mine
        const meL = cx - 5.98 * z / 2;
        const zsW = (meL - pad - 14 * u - 46 * u) / 3.53;
        const zsH = (st.h - pad - 130 * u) / (5.98 * 0.98);
        const zs = Math.min(0.9 * z, zsW, zsH);
        const syc = pad + 5.98 * zs * 0.49;
        const sx = pad + 46 * u + 3.53 * zs / 2;
        seats.push({ seat: 1, cx: sx, cy: syc, z: zs, mode: "full", rot: 90, tilt: 8, opp: true, quarter: true, persp: 2200, handAt: "corner" });
        seats.push({ seat: 3, cx: st.w - sx, cy: syc, z: zs, mode: "full", rot: 270, tilt: 8, opp: true, quarter: true, persp: 2200, handAt: "corner-l" });
      }
      const hcw = 0.78 * 0.686 * z;
      return {
        z, seats,
        hand: { cw: hcw, cx, y: meTop + meH + 10 * u },
        ring: { x: cx, y: ringY, scale: (ringH - 4 * u) / 124 },
        plaza: { cx, cy: ringY + 40 * u, scale: st.w / 1700, tilt: 60, persp: 1300, skyH: 140 * u, pads: pads(M, seats) },
      };
    },
    place(S, M, st, L, ctx, seatEls, u) {
      const hk = Math.max(0.95, Math.min(1.2, L.z / 112)) * u, taken = [];
      const W = (s) => (s === 0 ? 212 : 196) * hk, Hh = (s) => (s === 0 ? 112 : 96) * hk;
      const holo = {};
      const me = bx(ctx, seatEls, 0);
      if (S.format === "ffa3") {
        // three seats: rival plates sit on the outer flanks, clear of every board
        const a = bx(ctx, seatEls, 1), b = bx(ctx, seatEls, 2);
        holo[0] = settle({ x: me.r + 14 * u, y: me.b - Hh(0) - 30 * u, k: hk }, Hh(0) + 60 * u, W(0), taken);
        const fy = (bb) => [bb.b + 10 * u, me.t + 0.5 * (me.b - me.t) - Hh(1) / 2, me.b - Hh(1), st.h - 40 * u - Hh(1)];
        holo[1] = freeSpot([...fy(a).map((y) => ({ x: me.l - 18 * u, y, ax: "r", k: hk })), ...fy(a).map((y) => ({ x: 12 * u, y, k: hk }))], Hh(1), W(1), taken, ctx, seatEls, st, 1);
        holo[2] = freeSpot([...fy(b).map((y) => ({ x: st.w - 12 * u, y, ax: "r", k: hk })), ...fy(b).map((y) => ({ x: me.r + 18 * u, y, k: hk }))], Hh(2), W(2), taken, ctx, seatEls, st, 2);
      } else {
        const n = bx(ctx, seatEls, 2), w = bx(ctx, seatEls, 1), e = bx(ctx, seatEls, 3);
        holo[1] = settle({ x: w.r, y: w.b + 10 * u, ax: "r", k: hk }, Hh(1), W(1), taken);
        holo[3] = settle({ x: e.l, y: e.b + 10 * u, k: hk }, Hh(3), W(3), taken);
        // beside the across board's front-left corner; if the west board is in the way, tuck under it beside the ring
        const fits = n.l - 14 * u - W(2) > w.r + 8 * u;
        holo[2] = fits ? settle({ x: n.l - 14 * u, y: n.b, ax: "r", ay: "b", k: hk }, Hh(2), W(2), taken)
          : settle({ x: L.ring.x - 64 * L.ring.scale - 12 * u, y: n.b + 4 * u, ax: "r", k: hk }, Hh(2), W(2), taken);
      }
      if (!holo[0]) holo[0] = settle({ x: me.r + 14 * u, y: me.b - Hh(0) - 30 * u, k: hk }, Hh(0) + 60 * u, W(0), taken);
      const master = { x: me.r + 14 * u, y: holo[0].y + Hh(0) + 8 * u, k: hk * 0.95 };
      return { holo, master, cam: { x: 12 * u, y: st.h - 10 * u, ay: "b" }, target: S.format === "ffa3" ? 2 : 3, hover: { auto: true } };
    },
    chromeBuild: (S, M, screen, st, ch, u, H) => railBuild(S, M, screen, st, ch, u, H, true),
  };

  /* Arena and Spotlight share a vertical stack: rivals on top, the middle band (ring + shared EMZ pairs), then my
     board, whose front strip (Banished) tucks under the band, then the hand. */
  function bandStack(S, M, st, u, topBottom, capZ) {
    const bandH = 128 * u;
    const bandTop = topBottom;
    const bandY = bandTop + bandH / 2;
    const matTop = bandTop + bandH + 4 * u;
    const z = Math.min((st.h - matTop - 10 * u - 12 * u) / (2.45 + 0.78), capZ, st.w * 0.5 / 5.98);
    const meTop = matTop - 0.62 * z;
    const cx = st.w / 2;
    const ez = Math.min(0.86 * z, bandH - 26 * u);
    const ringScale = 1.0 * u;
    const off = 62 * ringScale + 0.75 * ez + 44 * u;
    const tag = (a, b) => `<b style="color:rgb(${M.by[a].T.ink})">${M.by[a].name}</b> ⇄ <b style="color:rgb(${M.by[b].T.ink})">${M.by[b].name}</b>`;
    const emz = S.format === "ffa3"
      ? [{ x: cx - off, y: bandY - 8 * u, z: ez, k: u, label: `<b style="color:rgb(${M.by[0].T.ink})">${M.by[0].name}</b> · own` }]
      : [[0, 2, -1], [1, 3, 1]].map(([a, b, side]) => {
        // an eliminated seat breaks its pair (sharedExtraPairs); the survivor keeps its own Extra Monster cells
        const live = [a, b].filter((s) => M.by[s] && !M.by[s].elim);
        const label = live.length === 2 ? tag(a, b) : live.map((s) => `<b style="color:rgb(${M.by[s].T.ink})">${M.by[s].name}</b> · own`).join("");
        return { x: cx + side * off, y: bandY - 8 * u, z: ez, k: u, label };
      });
    return {
      z, emz, bandY,
      me: { seat: 0, cx, cy: meTop + 3.07 * z / 2, z, mode: "band", guides: true },
      hand: { cw: 0.78 * 0.686 * z, cx, y: meTop + 3.07 * z + 8 * u },
      ring: { x: cx, y: bandY, scale: ringScale },
    };
  }
  function placeMe(L, ctx, seatEls, u) {
    const me = bx(ctx, seatEls, 0);
    const mk = Math.max(1, Math.min(1.25, L.z / 112)) * u;
    return {
      holo: { x: me.l - 18 * u, y: me.b - 64 * u * mk, ax: "r", ay: "b", k: mk },
      master: { x: me.l - 18 * u, y: me.b, ax: "r", ay: "b", k: mk * 0.95 },
    };
  }

  /* ============================================================ ARENA
     Rivals sit upright side by side across the top as receding fields. The turn ring sits in the middle band
     between them and me, flanked by the two shared Extra Monster pairs. My plaza is large; hand and bars as today. */
  K.concepts.arena = {
    chrome: (S, u) => railChrome(S, u, false),
    layout(S, M, st, u) {
      const rivals = M.seats.filter((d) => d.seat !== 0).map((d) => d.seat);
      const n = rivals.length;
      const pad = 10 * u, gap = 24 * u, tilt = 24;
      const zr = Math.min((st.w - 2 * pad - (n - 1) * gap) / (n * 5.98), st.h * 0.118);
      const rTop = pad + 0.26 * zr + 4 * u;
      const rH = 3.07 * zr * 0.91;
      // rival plates hang below the boards; the band starts under them
      const hang = Math.max(52 * u, 96 * Math.max(0.9, Math.min(1.15, zr / 100)) * u - 0.5 * zr + 4 * u);
      const B = bandStack(S, M, st, u, rTop + rH + hang, 1.36 * zr);
      const cx = st.w / 2;
      const rowW = n * 5.98 * zr + (n - 1) * gap;
      const seats = rivals.map((s, i) => ({ seat: s, cx: cx - rowW / 2 + 5.98 * zr * (i + 0.5) + gap * i, cy: rTop + rH / 2, z: zr, mode: "band", rot: 180, tilt, opp: true, persp: 1500 }));
      seats.push(B.me);
      return {
        z: B.z, zr, seats, emz: B.emz, hand: B.hand, ring: B.ring,
        plaza: { cx, cy: B.bandY + 30 * u, scale: st.w / 1650, tilt: 62, persp: 1300, skyH: 120 * u, pads: pads(M, seats) },
      };
    },
    place(S, M, st, L, ctx, seatEls, u) {
      const hk = Math.max(0.9, Math.min(1.15, L.zr / 100)) * u;
      const holo = {};
      L.seats.filter((p) => p.seat !== 0).forEach((p) => {
        const b = bx(ctx, seatEls, p.seat);
        // front-right corner, over the empty end of the front strip
        // a left-hand board ending at the centre keeps its plate clear of the ring
        const x = Math.min(b.cx < st.w / 2 - 20 * u ? Math.min(b.r - 6 * u, L.ring.x - 66 * L.ring.scale - 8 * u) : b.r - 6 * u, st.w - 8 * u);
        holo[p.seat] = { x, y: b.b - 0.5 * L.zr, ax: "r", k: hk };
      });
      const me = placeMe(L, ctx, seatEls, u);
      holo[0] = me.holo;
      return { holo, master: me.master, cam: { x: 12 * u, y: st.h - 10 * u, ay: "b" }, target: S.format === "ffa3" ? 2 : 3 };
    },
    chromeBuild: (S, M, screen, st, ch, u, H) => railBuild(S, M, screen, st, ch, u, H, false),
  };

  /* ============================================================ SPOTLIGHT
     One rival large across from you; the other two in the upper corners, yawed toward the centre. Tab cycles
     the spotlight; while you pick an attack target the wings grow so every card is at least 56 px. */
  const FOCUS_SEAT = { W: 1, N: 2, E: 3 };
  K.concepts.spotlight = {
    fly: true,
    chrome: (S, u) => railChrome(S, u, false),
    layout(S, M, st, u) {
      const pick = M.battle;
      const rivals = M.seats.filter((d) => d.seat !== 0).map((d) => d.seat);
      let f = FOCUS_SEAT[S.focus] ?? 2;
      if (!rivals.includes(f)) f = rivals[rivals.length - 1];
      // the camera orbits: the seat after the focus is on the right, the one before it on the left
      const i = rivals.indexOf(f);
      const left = rivals.length === 3 ? rivals[(i + 2) % 3] : rivals.length === 2 && i === 1 ? rivals[0] : null;
      const right = rivals.length === 3 ? rivals[(i + 1) % 3] : rivals.length === 2 && i === 0 ? rivals[1] : null;
      const pad = 10 * u, tilt = 20;
      const zf0 = Math.min(st.h * 0.124, st.w * 0.4 / 5.98);
      const zf = pick ? zf0 * 0.86 : zf0;
      const fTop = pad + 0.26 * zf0 + 4 * u;
      const fH = 3.07 * zf * 0.93;
      const fH0 = 3.07 * zf0 * 0.93;
      const B = bandStack(S, M, st, u, fTop + fH0 + 60 * u, 1.2 * zf0);
      const cx = st.w / 2;
      const seats = [{ seat: f, cx, cy: fTop + fH / 2, z: zf, mode: "band", rot: 180, tilt, opp: true, persp: 1500, focus: true }];
      // wings fill the room beside the focus board; while picking they flatten their yaw and grow
      const yaw = pick ? 12 : 22;
      const rad = (yaw * Math.PI) / 180;
      const span = 5.98 * Math.cos(rad) + 3.07 * Math.sin(rad);
      const room = cx - 5.98 * zf / 2 - pad - 16 * u;
      const zw = Math.min(room / span, zf0 * 0.86);
      const wx = pad + span * zw / 2;
      const wy = fTop + (5.98 * Math.sin(rad) + 3.07 * Math.cos(rad)) * zw * 0.93 / 2;
      if (left != null) seats.push({ seat: left, cx: wx, cy: wy, z: zw, mode: "band", rot: 180, yaw: -yaw, tilt: 18, opp: true, persp: 1500, onclick: () => K.setFocus(seatKey(left)) });
      if (right != null) seats.push({ seat: right, cx: st.w - wx, cy: wy, z: zw, mode: "band", rot: 180, yaw, tilt: 18, opp: true, persp: 1500, onclick: () => K.setFocus(seatKey(right)) });
      seats.push(B.me);
      return {
        z: B.z, zf, zw, f, seats, emz: B.emz, hand: B.hand, ring: B.ring,
        plaza: { cx, cy: B.bandY + 30 * u, scale: st.w / 1650, tilt: 62, persp: 1300, skyH: 120 * u, pads: pads(M, seats) },
      };
    },
    place(S, M, st, L, ctx, seatEls, u) {
      const holo = {};
      const fk = Math.max(0.95, Math.min(1.1, L.zf / 100)) * u, wk = 0.92 * u;
      const fb = bx(ctx, seatEls, L.f);
      holo[L.f] = { x: fb.r - 6 * u, y: fb.b - 0.5 * L.zf, ax: "r", k: fk };
      L.seats.filter((p) => p.seat !== 0 && p.seat !== L.f).forEach((p) => {
        const b = bx(ctx, seatEls, p.seat);
        const leftWing = p.cx < st.w / 2;
        holo[p.seat] = { x: leftWing ? b.l + 6 * u : b.r - 6 * u, y: b.b + 8 * u, ax: leftWing ? "" : "r", k: wk, key: "Tab" };
      });
      const me = placeMe(L, ctx, seatEls, u);
      holo[0] = me.holo;
      return { holo, master: me.master, cam: { x: 12 * u, y: st.h - 10 * u, ay: "b" }, target: L.f };
    },
    chromeBuild: (S, M, screen, st, ch, u, H) => railBuild(S, M, screen, st, ch, u, H, false),
  };
  function seatKey(seat) { return Object.keys(FOCUS_SEAT).find((k) => FOCUS_SEAT[k] === seat); }
})();
