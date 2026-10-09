"use client";

/**
 * The lamp and the table: the felt, the edge clock, your theme stack, anchors for the friends and the pack in front of you.
 * Cards deal in, pass out and gather to the stack with transform and opacity only (WAAPI), as the mock does.
 */
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { EASE_IN_OUT, EASE_OUT, animate, flight, motionCalm, motionOff, prefersReducedMotion, stagger, wait } from "./motion";
import { CardImg } from "./card-img";
import { EdgeClock } from "./edge-clock";
import { anchorDelta, anchorFor, packSlots, themeStackPoint, type Geometry, type Slot } from "./table-geometry";
import { blockedLabel, kindOf, type DealState, type RoomCard, type Turn } from "./room-model";

interface Item {
  card: RoomCard;
  slot: Slot;
  index: number;
}

interface TableProps {
  geometry: Geometry;
  deal: DealState;
  theme: boolean;
  phase: "main" | "extra";
  turn: Turn;
  direction: 1 | -1;
  /** Seats at the table, you included: indexes run clockwise from you. */
  seatCount: number;
  /** The pack ribbon is up: the table stays empty until it hides, then the cards deal in. */
  hold: boolean;
  /** This deal opened a pack or round with a ribbon, so the cards deal in from the middle (the mock's "deal"). */
  ribboned: boolean;
  /** Raised each time everyone is in. */
  settle: number;
  stepKey: string;
  pickSeconds: number;
  stackLabel: React.ReactNode;
  selectedId: number | null;
  lens: ((card: RoomCard) => boolean) | null;
  getLayer: () => HTMLElement | null;
  /** Where a pack comes to rest in front of a seat, for phone flights. */
  packRect: (seat: number) => DOMRect | null;
  onCardClick: (card: RoomCard) => void;
  onCardFocus: (card: RoomCard) => void;
  onCardPointerDown: () => void;
  onCardHover: (card: RoomCard | null) => void;
}

const hoverable = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(hover: hover)").matches;

export const Table = memo(function Table(props: TableProps) {
  const { geometry: g, deal, theme, phase, turn, direction, seatCount, settle, stepKey, pickSeconds, hold, ribboned } = props;
  const slots = useMemo(() => packSlots(g, deal.dealt.length, theme), [g, deal.dealt.length, theme]);
  const [clearedSeq, setClearedSeq] = useState(-1);
  const [leaving, setLeaving] = useState<{ batch: number; items: Item[]; mode: "pass" | "stack" } | null>(null);
  const cardsRef = useRef<HTMLDivElement>(null);
  const leaveRef = useRef<HTMLDivElement>(null);
  const batch = useRef(0);

  useLayoutEffect(() => {
    const stage = cardsRef.current?.closest(".stage");
    stage?.toggleAttribute("data-tall", g.tall);
    return () => stage?.removeAttribute("data-tall");
  }, [g.tall]);

  const visible: Item[] = useMemo(() => {
    if (clearedSeq === deal.seq || hold) return [];
    return deal.dealt
      .map((card, index) => ({ card, index, slot: slots[index] }))
      .filter((it) => it.card.id !== deal.pickedId && it.slot);
  }, [deal.dealt, deal.pickedId, deal.seq, slots, clearedSeq, hold]);

  const prev = useRef<{ seq: number; items: Item[] }>({ seq: deal.seq, items: [] });
  const mode = theme ? "stack" : "pass";

  // a new deal: whatever was left from the last step leaves first
  useLayoutEffect(() => {
    if (prev.current.seq !== deal.seq) {
      const left = prev.current.items;
      if (left.length) setLeaving({ batch: ++batch.current, items: left, mode });
    }
  }, [deal.seq, mode]);
  useLayoutEffect(() => {
    prev.current = { seq: deal.seq, items: visible };
  });

  // everyone is in: leftovers gather and slide to the next seat, or back to your stack
  const lastSettle = useRef(settle);
  useLayoutEffect(() => {
    if (settle === lastSettle.current) return;
    lastSettle.current = settle;
    if (!visible.length) return;
    setLeaving({ batch: ++batch.current, items: visible, mode });
    setClearedSeq(deal.seq);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settle]);

  /* leaving animation */
  useLayoutEffect(() => {
    if (!leaving) return;
    const host = leaveRef.current;
    if (!host) return;
    const els = Array.from(host.querySelectorAll<HTMLElement>(".tcard"));
    const target = (direction === 1 ? 1 : -1 + seatCount) % Math.max(1, seatCount);
    const done: Array<Promise<void>> = [];
    if (motionOff()) {
      setLeaving(null);
      return;
    }
    els.forEach((el, i) => {
      const it = leaving.items[i];
      if (!it) return;
      const mv = el.querySelector<HTMLElement>(".mv");
      if (leaving.mode === "stack") {
        const dl = anchorDelta(
          { x: themeStackPoint(g).x + themeStackPoint(g).w / 2, y: themeStackPoint(g).y + themeStackPoint(g).h / 2 },
          it.slot,
        );
        done.push(
          animate(
            mv,
            [
              { transform: "none", opacity: 1 },
              { opacity: 1, offset: 0.7 },
              { transform: `translate3d(${dl.x}px, ${dl.y}px, 20px) scale(0.6)`, opacity: 0 },
            ],
            { duration: 300, delay: stagger(i), easing: EASE_IN_OUT, fill: "forwards" },
          ),
        );
        return;
      }
      if (g.phone) {
        const dest = props.packRect(target);
        const face = el.querySelector<HTMLElement>(".face");
        if (dest && face) {
          const r = face.getBoundingClientRect();
          el.classList.add("gone");
          done.push(
            flight({
              layer: props.getLayer(),
              from: r,
              to: dest,
              src: el.querySelector("img")?.src,
              glow: "228 182 79",
              arc: 20,
              duration: 300,
              swell: 0,
              className: "pack-ghost",
            }),
          );
          return;
        }
      }
      const a = anchorFor(g, target, Math.max(2, seatCount));
      const dl = anchorDelta(a, it.slot);
      const cx = g.tw / 2 - (it.slot.x + it.slot.w / 2);
      const cy = g.th * 0.5 - (it.slot.y + it.slot.h / 2);
      const stackAt = `translate3d(${cx}px, ${cy}px, ${2 + i * 0.6}px) rotateZ(${(i % 3) - 1}deg)`;
      done.push(
        animate(
          mv,
          [
            { transform: "none", opacity: 1 },
            { transform: stackAt, opacity: 1, offset: 0.4 },
            { transform: stackAt, opacity: 1, offset: 0.5 },
            { transform: `translate3d(${dl.x}px, ${dl.y}px, 20px) scale(0.5)`, opacity: 0 },
          ],
          { duration: 560, delay: stagger(i), easing: EASE_IN_OUT, fill: "forwards" },
        ),
      );
    });
    let alive = true;
    // a hidden tab can stall animations, so the cards are cleared after a moment either way
    Promise.race([Promise.all(done), wait(1600)]).then(() => {
      if (alive) setLeaving((cur) => (cur && cur.batch === leaving.batch ? null : cur));
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaving?.batch]);

  /* deal in */
  const dealt = useRef(-1);
  useLayoutEffect(() => {
    if (hold || dealt.current === deal.seq || deal.seq === 0) return;
    dealt.current = deal.seq;
    const host = cardsRef.current;
    if (!host || motionOff()) return;
    const els = Array.from(host.querySelectorAll<HTMLElement>(".tcard"));
    const n = els.length;
    const incoming = (0 - direction + seatCount) % Math.max(1, seatCount);
    els.forEach((el, i) => {
      const s = slots[Number(el.dataset.index)];
      if (!s) return;
      const mv = el.querySelector<HTMLElement>(".mv");
      const flip = el.querySelector<HTMLElement>(".flip");
      if (deal.reason === "pass" && !ribboned) {
        if (g.phone) {
          animate(
            mv,
            [
              { transform: `translate3d(0, ${-g.th * 0.7}px, 40px) scale(0.5)`, opacity: 0 },
              { opacity: 1, offset: 0.35 },
              { transform: "none", opacity: 1 },
            ],
            { duration: 300, delay: stagger(i), easing: EASE_OUT, fill: "backwards" },
          );
          return;
        }
        const dl = anchorDelta(anchorFor(g, incoming, Math.max(2, seatCount)), s);
        animate(
          mv,
          [
            { transform: `translate3d(${dl.x}px, ${dl.y}px, 30px) rotateZ(${direction * 8}deg) scale(0.5)`, opacity: 0 },
            { opacity: 1, offset: 0.25 },
            { transform: "none", opacity: 1 },
          ],
          { duration: 300, delay: stagger(i), easing: EASE_OUT, fill: "backwards" },
        );
        return;
      }
      const stack = themeStackPoint(g);
      const src =
        deal.reason === "stack"
          ? anchorDelta({ x: stack.x + stack.w / 2, y: stack.y + stack.h / 2 }, s)
          : { x: g.tw / 2 - (s.x + s.w / 2), y: g.th * 0.45 - (s.y + s.h / 2) };
      // quick: each card 20ms after the last (none after the eighth), the flip shorter than before
      const delay = 60 + stagger(i);
      animate(
        mv,
        [
          { transform: `translate3d(${src.x}px, ${src.y}px, 60px) rotateZ(${(i % 2 ? -1 : 1) * 6}deg)`, opacity: 0 },
          { opacity: 1, offset: 0.3 },
          { transform: "none", opacity: 1 },
        ],
        { duration: 300, delay, easing: EASE_OUT, fill: "backwards" },
      );
      animate(
        flip,
        [{ transform: "rotateY(180deg)" }, { transform: "rotateY(180deg)", offset: 0.3 }, { transform: "rotateY(0deg)" }],
        { duration: 420, delay, easing: EASE_IN_OUT, fill: "backwards" },
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deal.seq, hold]);

  /* the lamp catches a card now and then while you choose */
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const glint = () => {
      t = setTimeout(glint, 2400 + Math.random() * 2600);
      const host = cardsRef.current;
      if (!host || motionCalm() || turn !== "picking" || document.hidden) return;
      const pool = Array.from(host.children).filter(
        (el) => !el.hasAttribute("data-sel") && !el.hasAttribute("data-blocked") && (el as HTMLElement).dataset.lens !== "miss",
      ) as HTMLElement[];
      const el = pool[Math.floor(Math.random() * pool.length)];
      if (!el) return;
      el.setAttribute("data-glint", "");
      setTimeout(() => el.removeAttribute("data-glint"), 1200);
    };
    t = setTimeout(glint, 2500);
    return () => clearTimeout(t);
  }, [turn]);

  const dust = useMemo(
    () =>
      Array.from({ length: 14 }, (_, i) => {
        // fixed pseudo-random values, so the dust is the same on every render
        const r = (n: number) => ((Math.sin((i + 1) * 12.9898 + n * 78.233) * 43758.5453) % 1 + 1) % 1;
        return {
          left: `${(r(1) * 100).toFixed(1)}%`,
          top: `${(r(2) * 80).toFixed(1)}%`,
          "--s": `${(1.4 + r(3) * 1.8).toFixed(1)}px`,
          "--o": (0.2 + r(4) * 0.45).toFixed(2),
          "--t": `${(11 + r(5) * 10).toFixed(1)}s`,
          "--dl": `${(-r(6) * 20).toFixed(1)}s`,
          "--dx": `${Math.round(r(7) * 60 - 30)}px`,
          "--dy": `${Math.round(r(8) * 80 - 25)}px`,
        } as React.CSSProperties;
      }),
    [],
  );

  const canHover = hoverable();
  const stack = themeStackPoint(g);
  const renderCard = (it: Item, key: string, interactive: boolean) => {
    const kind = kindOf(it.card);
    const blocked = !!it.card.blocked;
    return (
      <div
        key={key}
        className="tcard"
        tabIndex={interactive ? 0 : -1}
        role="button"
        aria-label={blocked ? `${it.card.name}. ${blockedLabel(it.card)}, cannot be picked` : it.card.name}
        aria-disabled={blocked || undefined}
        aria-hidden={interactive ? undefined : true}
        data-id={it.card.id}
        data-kind={kind}
        data-blocked={blocked ? "" : undefined}
        data-index={it.index}
        data-sel={interactive && props.selectedId === it.card.id ? "" : undefined}
        data-lens={interactive && props.lens ? (props.lens(it.card) ? "hit" : "miss") : undefined}
        style={
          {
            "--x": `${it.slot.x}px`,
            "--y": `${it.slot.y}px`,
            "--w": `${it.slot.w}px`,
            "--h": `${it.slot.h}px`,
          } as React.CSSProperties
        }
        onClick={interactive ? () => props.onCardClick(it.card) : undefined}
        onKeyDown={interactive ? (e) => {
          if (e.key !== " ") return;
          e.preventDefault();
          if (!e.repeat) props.onCardClick(it.card);
        } : undefined}
        onFocus={interactive ? (e) => {
          props.onCardFocus(it.card);
          if (g.tall) {
            e.currentTarget.scrollIntoView?.({
              block: "nearest",
              behavior: prefersReducedMotion() || motionOff() ? "instant" : "smooth",
            });
          }
        } : undefined}
        onPointerDown={interactive ? props.onCardPointerDown : undefined}
        onPointerEnter={interactive && canHover ? () => props.onCardHover(it.card) : undefined}
        onPointerLeave={interactive && canHover ? () => props.onCardHover(null) : undefined}
      >
        <span className="mv">
          <span className="lift">
            <span className="shadow" />
            <span className="flip">
              <span className="face">
                <CardImg key={it.card.id} card={it.card} eager placeholder={kind === "extra" ? "extra" : "main"} />
              </span>
              <span className={`back${kind === "extra" ? " x" : ""}`} />
            </span>
            <span className="ix">{it.index < 9 ? String(it.index + 1) : ""}</span>
            {blocked ? <span className="cap">{blockedLabel(it.card)}</span> : null}
          </span>
        </span>
      </div>
    );
  };

  return (
    <>
      <div className="lamp" aria-hidden="true">
        <i className="pool" />
        <div className="dust">
          {dust.map((style, i) => (
            <i key={i} style={style} />
          ))}
        </div>
      </div>
      <div
        className="scene"
        style={{ "--tw": `${g.tw}px`, "--th": `${g.th}px`, "--tilt": `${g.tilt}deg` } as React.CSSProperties}
      >
        <div className="dr-table">
          <div className="felt">
            <div className="flow far">
              <i />
            </div>
            <div className="flow near">
              <i />
            </div>
          </div>
          <EdgeClock w={g.tw} h={g.th} turn={turn} total={pickSeconds} relayKey={stepKey} flareKey={settle} />
          <div
            className="tstack"
            style={{ left: stack.x, top: stack.y, width: stack.w, height: stack.h }}
            data-phase={phase}
          >
            <i />
            <i />
            <i />
            <b>{props.stackLabel}</b>
          </div>
          <div className="anchors">
            {Array.from({ length: Math.max(2, seatCount) }, (_, i) => {
              const p = anchorFor(g, i, Math.max(2, seatCount));
              return <div key={i} className="anchor" data-anchor={i} style={{ left: p.x, top: p.y }} />;
            })}
          </div>
          <div ref={cardsRef}>{visible.map((it) => renderCard(it, `c${it.card.id}`, true))}</div>
          <div ref={leaveRef}>{leaving?.items.map((it) => renderCard(it, `l${leaving.batch}:${it.card.id}`, false))}</div>
        </div>
      </div>
    </>
  );
});
