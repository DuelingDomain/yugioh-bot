"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { startWall } from "./login-wall-engine";
import {
  cardImageSrc,
  computeLayout,
  layoutKey,
  railDeck,
  railOffset,
  railOpacity,
  railPitch,
  railSeed,
  type WallLayout,
} from "./login-wall-model";
import styles from "./login-wall.module.css";

/** `first` is true for the build after page load; later builds (a resize) skip the entrance. */
type Built = { layout: WallLayout; key: string; reduced: boolean; first: boolean; delay: number };

/**
 * Wall cards are plain <img>, not next/image: there are 30 to 100 of them, all small, all
 * decoration, and the optimizer would only add a request hop per card. Width and height are the
 * art's own ratio so nothing shifts while they load.
 */
function WallCard({ id }: { id: number }) {
  return (
    <div className={styles.card} data-card={id}>
      <div className={styles.face}>
        <img src={cardImageSrc(id)} alt="" width={268} height={391} loading="lazy" decoding="async" draggable={false} />
      </div>
    </div>
  );
}

function Rail({ layout, wallIndex, column }: { layout: WallLayout; wallIndex: number; column: number }) {
  const deck = railDeck(railSeed(wallIndex, column), layout.n);
  const offset = railOffset(wallIndex, column, railPitch(layout));
  const style: CSSProperties = layout.mode === "walls" ? { marginTop: -offset } : { marginLeft: -offset };
  // The same set twice: drifting by half the rail repeats with no seam.
  return (
    <div className={styles.rail} data-n={layout.n} style={{ ...style, "--o": railOpacity(layout.mode, column) } as CSSProperties}>
      {[0, 1].flatMap((copy) => deck.map((id, i) => <WallCard key={`${copy}:${i}`} id={id} />))}
    </div>
  );
}

function Rails({ layout, wallIndex }: { layout: WallLayout | null; wallIndex: number }) {
  if (!layout) return null;
  const columns = layout.mode === "walls" ? layout.cols : 1;
  return Array.from({ length: columns }, (_, column) => <Rail key={column} layout={layout} wallIndex={wallIndex} column={column} />);
}

function useViewportLayout(hasMessage: boolean, wallsRef: RefObject<HTMLDivElement | null>) {
  const [built, setBuilt] = useState<Built | null>(null);

  useEffect(() => {
    // No matchMedia means no browser to draw for. The page works without the wall.
    if (typeof window.matchMedia !== "function") return;
    const reducedQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    let timer: ReturnType<typeof setTimeout> | undefined;
    let first = true;

    const measure = () => {
      const layout = computeLayout(
        { width: window.innerWidth, height: window.innerHeight },
        wallsRef.current?.offsetHeight ?? 0,
        hasMessage,
      );
      const reduced = reducedQuery.matches;
      const key = `${layoutKey(layout)}:${reduced ? "still" : "live"}`;
      const isFirst = first;
      first = false;
      setBuilt((current) => {
        if (current && current.key === key) return current;
        // The walls arrive 650ms after the page starts, however long the script took.
        const delay = isFirst && !current ? Math.max(0, 650 - performance.now()) : 0;
        return { layout, key, reduced, first: isFirst && !current, delay };
      });
    };

    const onResize = () => {
      clearTimeout(timer);
      timer = setTimeout(measure, 200);
    };

    measure();
    window.addEventListener("resize", onResize);
    // Debounced like a resize: a change in the setting rebuilds the walls as a still frame or a live one.
    const onReducedChange = () => onResize();
    reducedQuery.addEventListener?.("change", onReducedChange);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("resize", onResize);
      reducedQuery.removeEventListener?.("change", onReducedChange);
    };
  }, [hasMessage, wallsRef]);

  return built;
}

/**
 * The decoration around the sign-in stack. It renders the stack's children untouched, so the
 * ring, copy and button are server output and work with no script. The wall itself is empty
 * until the browser has measured the window; then it builds the cards and starts the motion.
 * Every part of the wall is aria-hidden, holds nothing focusable and ignores the pointer.
 */
export function LoginWall({ hasMessage = false, children }: { hasMessage?: boolean; children: ReactNode }) {
  const wallsRef = useRef<HTMLDivElement>(null);
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const botRef = useRef<HTMLDivElement>(null);
  const built = useViewportLayout(hasMessage, wallsRef);
  const layout = built?.layout ?? null;
  const bands = layout?.mode === "bands";
  const walls = layout?.mode === "walls";

  useEffect(() => {
    if (!built || built.reduced) return;
    const els = (list: Array<HTMLDivElement | null>) => list.filter((el): el is HTMLDivElement => el !== null);
    return startWall({
      mode: built.layout.mode,
      sides: els([leftRef.current, rightRef.current]),
      bands: els([topRef.current, built.layout.bottomBand ? botRef.current : null]),
      classes: { pick: styles.pick, sheen: styles.sheen },
      rebuild: !built.first,
      sinceLoad: performance.now(),
    });
  }, [built]);

  const ready = built ? styles.ready : "";
  const fade = built ? ({ "--in-delay": `${Math.round(built.delay)}ms` } as CSSProperties) : undefined;

  return (
    <>
      <div ref={wallsRef} className={`${styles.walls} ${ready}`} style={fade} aria-hidden="true" data-login-wall="sides">
        <div ref={leftRef} className={`${styles.side} ${styles.left}`}>
          <div className={styles.wall}>{walls && <Rails layout={layout} wallIndex={0} />}</div>
        </div>
        <div ref={rightRef} className={`${styles.side} ${styles.right}`}>
          <div className={styles.wall}>{walls && <Rails layout={layout} wallIndex={1} />}</div>
        </div>
      </div>
      <div ref={topRef} className={`${styles.band} ${styles.top} ${ready}`} style={fade} aria-hidden="true" data-login-wall="top">
        <div className={styles.wall}>{bands && <Rails layout={layout} wallIndex={0} />}</div>
      </div>
      {children}
      <div
        ref={botRef}
        className={`${styles.band} ${styles.bot} ${ready} ${hasMessage ? styles.noBottom : ""}`}
        style={fade}
        aria-hidden="true"
        data-login-wall="bottom"
      >
        <div className={styles.wall}>{layout?.mode === "bands" && layout.bottomBand && <Rails layout={layout} wallIndex={1} />}</div>
      </div>
    </>
  );
}
