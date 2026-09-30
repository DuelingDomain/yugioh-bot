"use client";

import { useState } from "react";
import { cardArtUrl } from "@/components/duel/constants";
import styles from "./editor.module.css";

/** Small card art. A card without an image (a promo or a new passcode) shows its name instead. */
export function CardArt({ code, name }: { code: number; name: string }) {
  const [failed, setFailed] = useState<number | null>(null);
  if (failed === code) return <span className={styles.artFallback}>{name}</span>;
  return <img src={cardArtUrl(code, "small")} alt="" loading="lazy" draggable={false} onError={() => setFailed(code)} />;
}
