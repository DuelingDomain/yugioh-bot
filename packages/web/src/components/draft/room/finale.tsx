"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef } from "react";
import { FullscreenLayer } from "./layer";
import { animate } from "./motion";
import { KINDS, KIND_LABEL, countKinds, kindOf, type RoomCard } from "./room-model";

export interface FinaleProps {
  slug: string;
  pool: RoomCard[];
  theme: boolean;
  /** How many of the picks are Extra deck cards (theme drafts). */
  extraCount: number;
  canBuild: boolean;
  onExport: () => void;
  onClose: () => void;
}

/** "Draft complete": shown over the page when the draft finishes while you are in the room. */
export function DraftFinale(p: FinaleProps) {
  const counts = useMemo(() => countKinds(p.pool), [p.pool]);
  const fan = useMemo(() => p.pool.slice(-7), [p.pool]);
  const monsters = p.pool.filter((c) => kindOf(c) === "monster");
  const noTribute = monsters.filter((c) => (c.level ?? 0) <= 4).length;
  const mainCount = p.pool.length - p.extraCount;
  const sub = p.theme
    ? `${mainCount} main deck cards and ${p.extraCount} for the Extra Deck.`
    : `${p.pool.length} cards drafted. Your deck starts here.`;
  const first = useRef<HTMLAnchorElement | HTMLButtonElement>(null);
  const word = useRef<HTMLHeadingElement>(null);
  const fanRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    first.current?.focus();
    animate(word.current, [{ opacity: 0, transform: "scale(1.75)" }, { opacity: 1, transform: "scale(1)" }], {
      duration: 420,
      easing: "cubic-bezier(0.2,0.9,0.3,1)",
      fill: "backwards",
    });
    const imgs = Array.from(fanRef.current?.children ?? []);
    imgs.forEach((img, i) => {
      const a = (i - (imgs.length - 1) / 2) * 9;
      animate(img, [{ transform: "rotate(0deg) translateY(30px)", opacity: 0 }, { transform: `rotate(${a}deg)`, opacity: 1 }], {
        duration: 520,
        delay: 300 + i * 60,
        easing: "cubic-bezier(0.16,1,0.3,1)",
        fill: "backwards",
      });
    });
  }, []);

  return (
    <FullscreenLayer label="Draft complete">
      <div
        className="finale"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            p.onClose();
          }
        }}
      >
        <div className="frame">
          <i className="pip" />
          <i className="pip" />
          <i className="pip" />
          <i className="pip" />
          <h2 className="fin-word" ref={word}>
            Draft complete
          </h2>
          <p className="fin-sub">{sub}</p>
          <div className="fin-fan" ref={fanRef}>
            {fan.map((c, i) => {
              const n = fan.length;
              const a = (i - (n - 1) / 2) * 9;
              return (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={`${c.id}-${i}`} src={c.imageUrlSmall || c.imageUrl} alt="" style={{ transform: `rotate(${a}deg)` }} />
              );
            })}
          </div>
          <div className="fin-mix">
            <div className="mix-bar">
              {KINDS.map((k) => (
                <i key={k} data-kind={k} style={{ "--n": counts[k] } as React.CSSProperties} />
              ))}
            </div>
            <div className="fin-counts">
              {KINDS.map((k) => (
                <div key={k} data-kind={k}>
                  <b>{counts[k]}</b>
                  <span>
                    <i />
                    {KIND_LABEL[k]}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <p className="fin-note">{`${noTribute} of your ${monsters.length} main deck monsters need no tribute.`}</p>
          <div className="fin-actions">
            {p.canBuild ? (
              <Link className="pick-btn" href={`/decks/draft/${p.slug}`} ref={first as React.Ref<HTMLAnchorElement>}>
                <span>Build your deck</span>
              </Link>
            ) : null}
            <button className="btn-2" type="button" onClick={p.onExport} ref={p.canBuild ? undefined : (first as React.Ref<HTMLButtonElement>)}>
              Export YDK
            </button>
            <Link className="btn-2" href="/drafts">
              Back to drafts
            </Link>
            <button className="btn-2" type="button" onClick={p.onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    </FullscreenLayer>
  );
}
