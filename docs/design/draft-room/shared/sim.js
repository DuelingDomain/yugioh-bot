/* Draft simulation shared by the three draft-room mocks.
   It follows the real rules in packages/shared/src/services/drafts.ts:
   - Cube draft: every seat opens a pack of `packSize`; all seats pick against ONE shared deadline
     per step; when every seat has picked, every pack moves one seat at once (lockstep).
     Odd packs pass +1, even packs pass -1. Packs = ceil(cardsPerPlayer / packSize); the last pack
     stops once each player holds cardsPerPlayer cards.
   - Theme draft: each round every seat gets a private pack of `themePackSize` from its own theme
     pool. Nothing passes. Rounds 1..cardsPerPlayer are the main deck, then extraDeckSize extra rounds.
   - When the clock runs out, every seat that has not picked gets a uniformly random card.
   Other seats only expose hasPicked, as the real seat list does; their picks stay hidden.
   Renderers listen with sim.on(type, fn): step, seat, pick, settle, complete, jump. */
(function (global) {
  "use strict";

  const EXTRA_FRAMES = new Set(["fusion", "synchro", "xyz", "link", "fusion_pendulum", "synchro_pendulum", "xyz_pendulum"]);

  function kindOf(card) {
    const f = (card && card.frame) || "";
    if (f === "spell") return "spell";
    if (f === "trap") return "trap";
    if (EXTRA_FRAMES.has(f)) return "extra";
    return "monster";
  }

  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function create(options) {
    const o = Object.assign(
      {
        mode: "booster",
        seats: ["You", "Seat 2"],
        packSize: 15,
        cardsPerPlayer: 40,
        pickSeconds: 45,
        themePackSize: 3,
        extraDeckSize: 15,
        settleMs: 650,
        pace: "normal", // "normal" | "holdout" (the slow seat never picks; the clock picks for them)
        slowSeat: 3,
        seed: 11,
        cards: global.CARDS || [],
        theme: null, // { name, main: Card[], extra: Card[] }
      },
      options || {},
    );

    const R = rng(o.seed);
    const rand = (a, b) => a + (b - a) * R();
    const now = () => performance.now();
    const isTheme = o.mode === "theme";
    const N = o.seats.length;
    const totalPacks = Math.ceil(o.cardsPerPlayer / o.packSize);
    const totalRounds = o.cardsPerPlayer + (o.extraDeckSize || 0);

    const listeners = new Map();
    function on(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
      return () => listeners.get(type).delete(fn);
    }
    // A renderer error must never stall the draft, so each listener runs on its own.
    function emit(type, detail) {
      const call = (fn, ...a) => {
        try {
          fn(...a);
        } catch (e) {
          console.error(e);
        }
      };
      (listeners.get(type) || []).forEach((fn) => call(fn, detail));
      (listeners.get("*") || []).forEach((fn) => call(fn, type, detail));
    }

    const seats = o.seats.map((s, i) => ({
      seatIndex: i,
      name: typeof s === "string" ? s : s.name,
      theme: typeof s === "string" ? null : s.theme || null,
      isMe: i === 0,
      hasPicked: false,
      picks: 0,
    }));

    const st = {
      status: "pending",
      pack: 1,
      step: 1,
      round: 1,
      direction: 1,
      incomingFrom: null,
      deadline: 0,
      packs: seats.map(() => []),
      pool: [],
      botAt: seats.map(() => null),
      frozenAt: 0,
      pace: o.pace,
    };

    let uid = 0;
    const deal = (card) => ({ uid: "d" + ++uid, card, kind: kindOf(card) });

    let bag = [];
    function shuffle(a) {
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(R() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    }
    function draw(used) {
      for (let tries = 0; tries < 400; tries++) {
        if (!bag.length) bag = shuffle(o.cards.slice());
        const c = bag.pop();
        if (!used.has(c.id)) {
          used.add(c.id);
          return c;
        }
        bag.unshift(c);
      }
      return o.cards[0];
    }

    const stepsInPack = (p) => Math.min(o.packSize, o.cardsPerPlayer - (p - 1) * o.packSize);
    const phaseOf = (r) => (r <= o.cardsPerPlayer ? "main" : "extra");
    const me = () => seats[0];

    function counts() {
      const c = { monster: 0, spell: 0, trap: 0, extra: 0, total: st.pool.length, main: 0 };
      st.pool.forEach((p) => {
        c[p.kind]++;
        if (p.phase !== "extra") c.main++;
      });
      return c;
    }

    function snapshot(reason) {
      const c = counts();
      return {
        reason,
        mode: o.mode,
        status: st.status,
        pack: st.pack,
        totalPacks,
        step: st.step,
        stepsInPack: stepsInPack(st.pack),
        round: st.round,
        totalRounds,
        phase: phaseOf(st.round),
        mainDrafted: st.pool.filter((p) => p.phase !== "extra").length,
        extraDrafted: st.pool.filter((p) => p.phase === "extra").length,
        cardsPerPlayer: o.cardsPerPlayer,
        extraDeckSize: o.extraDeckSize,
        packSize: isTheme ? o.themePackSize : o.packSize,
        direction: st.direction,
        incomingFrom: st.incomingFrom,
        myPack: st.packs[0].slice(),
        deadline: st.deadline,
        pickSeconds: o.pickSeconds,
        seats: seats.map((s) => Object.assign({}, s)),
        pool: st.pool.slice(),
        counts: c,
        theme: o.theme ? { name: o.theme.name } : null,
      };
    }

    function openBoosterPack() {
      st.direction = st.pack % 2 === 1 ? 1 : -1;
      st.incomingFrom = null;
      st.packs = seats.map(() => {
        const used = new Set();
        return Array.from({ length: o.packSize }, () => deal(draw(used)));
      });
    }

    function openThemeRound() {
      const pool = phaseOf(st.round) === "main" ? o.theme.main : o.theme.extra;
      const used = new Set();
      const pack = [];
      const src = shuffle(pool.slice());
      for (const c of src) {
        if (pack.length >= o.themePackSize) break;
        if (used.has(c.id)) continue;
        used.add(c.id);
        pack.push(deal(c));
      }
      st.packs = seats.map((s, i) => (i === 0 ? pack : []));
      st.direction = 0;
      st.incomingFrom = null;
    }

    function paceFor(i) {
      if (i === o.slowSeat) return st.pace === "holdout" ? null : rand(7, 16) * 1000;
      return rand(1.4, 7.5) * 1000;
    }

    function openStep(reason, silent) {
      const t = now();
      seats.forEach((s, i) => {
        s.hasPicked = false;
        st.botAt[i] = s.isMe ? null : (() => {
          const d = paceFor(i);
          return d == null ? null : t + d;
        })();
      });
      st.deadline = t + o.pickSeconds * 1000;
      st.status = "active";
      if (!silent) emit("step", snapshot(reason));
    }

    function removeFromPack(seatIndex, pickUid) {
      const pack = st.packs[seatIndex];
      if (!pack.length) return null;
      let idx = pickUid ? pack.findIndex((d) => d.uid === pickUid) : Math.floor(R() * pack.length);
      if (idx < 0) return null;
      const [d] = pack.splice(idx, 1);
      return { dealt: d, index: idx };
    }

    function recordMine(res, how) {
      const entry = Object.assign({}, res.dealt, {
        auto: how,
        pack: st.pack,
        step: st.step,
        round: st.round,
        phase: phaseOf(st.round),
      });
      st.pool.push(entry);
      me().hasPicked = true;
      me().picks++;
      return entry;
    }

    function botPick(i, auto, silent) {
      const s = seats[i];
      if (s.hasPicked) return;
      if (!isTheme) removeFromPack(i, null);
      s.hasPicked = true;
      s.picks++;
      if (!silent) emit("seat", { seatIndex: i, auto: !!auto, seats: seats.map((x) => Object.assign({}, x)) });
    }

    function pick(pickUid) {
      if (st.status !== "active" || me().hasPicked) return false;
      const res = removeFromPack(0, pickUid);
      if (!res) return false;
      const entry = recordMine(res, false);
      // Players who are still deciding finish within a few seconds of you; the slow seat lags behind.
      const t = now();
      seats.forEach((s, i) => {
        if (s.isMe || s.hasPicked || st.botAt[i] == null) return;
        const lag = i === o.slowSeat ? rand(2.4, 4.6) : rand(0.9, 3.2);
        st.botAt[i] = Math.max(t + (i === o.slowSeat ? 2200 : 600), Math.min(st.botAt[i], t + lag * 1000));
      });
      emit("pick", { entry, index: res.index, auto: false, snapshot: snapshot("pick") });
      check();
      return true;
    }

    function expire() {
      seats.forEach((s, i) => {
        if (s.hasPicked) return;
        if (s.isMe) {
          const res = removeFromPack(0, null);
          if (!res) return;
          const entry = recordMine(res, "clock");
          emit("pick", { entry, index: res.index, auto: true, snapshot: snapshot("pick") });
        } else botPick(i, true);
      });
      check();
    }

    function check() {
      if (seats.every((s) => s.hasPicked)) {
        st.status = "settling";
        emit("settle", snapshot("settle"));
        setTimeout(() => advance(false), o.settleMs);
      }
    }

    function complete() {
      st.status = "complete";
      st.deadline = now();
      emit("complete", snapshot("complete"));
    }

    function advance(silent) {
      if (st.status === "complete") return;
      if (isTheme) {
        if (st.round >= totalRounds) return complete();
        const before = phaseOf(st.round);
        st.round++;
        openThemeRound();
        return openStep(phaseOf(st.round) !== before ? "phase" : "round", silent);
      }
      if (me().picks >= o.cardsPerPlayer) return complete();
      if (st.step >= stepsInPack(st.pack)) {
        st.pack++;
        st.step = 1;
        openBoosterPack();
        return openStep("pack", silent);
      }
      const d = st.direction;
      const next = new Array(N);
      for (let s = 0; s < N; s++) next[(s + d + N) % N] = st.packs[s];
      st.packs = next;
      st.step++;
      st.incomingFrom = (N - d) % N;
      openStep("pass", silent);
    }

    function loop() {
      if (st.status !== "active" || st.frozenAt) return;
      const t = now();
      let picked = false;
      seats.forEach((s, i) => {
        if (!s.isMe && !s.hasPicked && st.botAt[i] != null && t >= st.botAt[i]) {
          botPick(i, false);
          picked = true;
        }
      });
      if (picked) check();
      if (st.status === "active" && t >= st.deadline) expire();
    }
    setInterval(loop, 100);

    // Fast-forward for the mock controls: everybody picks at random, silently, until `done()`.
    function fastForward(done, reason) {
      emit("jump", { to: reason });
      let guard = 0;
      while (!done() && st.status !== "complete" && guard++ < 2000) {
        seats.forEach((s, i) => {
          if (s.hasPicked) return;
          if (s.isMe) {
            const res = removeFromPack(0, null);
            if (res) recordMine(res, "skip");
            else me().hasPicked = true;
          } else botPick(i, false, true);
        });
        advance(true);
      }
      if (st.status === "complete") return;
      emit("step", snapshot(reason));
    }

    const api = {
      on,
      kindOf,
      get state() {
        return snapshot("read");
      },
      get options() {
        return o;
      },
      start() {
        if (st.status !== "pending") return;
        if (isTheme) openThemeRound();
        else openBoosterPack();
        openStep("start", false);
      },
      pick,
      remaining() {
        if (st.status === "complete") return 0;
        if (st.status === "pending") return o.pickSeconds * 1000;
        const t = st.frozenAt || now();
        return Math.max(0, st.deadline - t);
      },
      setPace(p) {
        st.pace = p;
        if (p === "holdout" && !seats[o.slowSeat].hasPicked) st.botAt[o.slowSeat] = null;
        if (p === "normal" && st.botAt[o.slowSeat] == null && !seats[o.slowSeat].hasPicked)
          st.botAt[o.slowSeat] = now() + rand(2, 5) * 1000;
      },
      freeze(on) {
        if (on && !st.frozenAt) st.frozenAt = now();
        else if (!on && st.frozenAt) {
          const d = now() - st.frozenAt;
          st.deadline += d;
          st.botAt = st.botAt.map((t) => (t == null ? t : t + d));
          st.frozenAt = 0;
        }
      },
      jump(to) {
        if (st.status === "pending") api.start();
        if (st.status === "settling") return;
        if (to === "nextPack" && !isTheme) {
          const p = st.pack;
          fastForward(() => st.pack > p, "pack");
        } else if (to === "late" && !isTheme) {
          const p = st.pack;
          fastForward(() => st.pack !== p || stepsInPack(p) - st.step < 3, "pass");
        } else if (to === "extra" && isTheme) {
          fastForward(() => phaseOf(st.round) === "extra", "phase");
        } else if (to === "finish") {
          fastForward(() => false, "finish");
        }
      },
    };
    return api;
  }

  global.DraftSim = { create, kindOf };
})(window);
