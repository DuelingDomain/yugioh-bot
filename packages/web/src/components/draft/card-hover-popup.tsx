import { cardArtworkId } from "@/lib/card-image-url";
import { useEffect } from "react";
import { CardArt } from "@/components/cards/card-art";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { POPUP_MARGIN, POPUP_WIDTH } from "@/lib/card-popup-position";
import type { CardSummary } from "@/lib/card-types";
import styles from "./card-hover-popup.module.css";

interface CardHoverPopupProps {
  card: CardSummary;
  position: { left: number; top: number };
  imageError: boolean;
  onImageError: () => void;
  dismissible?: boolean;
  onDismiss?: () => void;
}

export function CardHoverPopup({ card, position, imageError, onImageError, dismissible = false, onDismiss }: CardHoverPopupProps) {
  const isMonster = card.type.toLowerCase().includes("monster");

  useEffect(() => {
    if (!dismissible || !onDismiss) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onDismiss(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dismissible, onDismiss]);

  return (
    <>
      {dismissible && (
        <div className="fixed inset-0 z-40" aria-hidden="true" data-testid="card-hover-popup-backdrop" onClick={() => onDismiss?.()} />
      )}
      <div
        className={cn(
          "fixed z-50",
          dismissible ? "block" : "pointer-events-none hidden lg:block",
        )}
        style={{
          left: `${position.left}px`,
          top: `${position.top}px`,
          width: POPUP_WIDTH,
          maxWidth: `calc(100vw - ${POPUP_MARGIN * 2}px)`,
        }}
        data-testid="card-hover-popup"
      >
        <div className={styles.panel}>
          {dismissible && onDismiss && (
            <button type="button" aria-label="Close preview" onClick={onDismiss} className={styles.close}>
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
          <div className={styles.art}>
            <div className="card-frame isolate w-full bg-bg-elevated">
              {imageError ? (
                <div className={styles.noImage}>No image</div>
              ) : (
                <CardArt
                  cardId={cardArtworkId(card)}
                  smallSrc={card.imageUrlSmall || card.imageUrl}
                  fullSrc={card.imageUrl}
                  alt={card.name}
                  sizes="120px"
                  loadFull
                  className="object-contain"
                  onError={onImageError}
                />
              )}
            </div>
            {(card.qty ?? 1) > 1 && <div className={styles.qty}>×{card.qty}</div>}
          </div>
          <div className={styles.details}>
            <h3 className={styles.name}>{card.name}</h3>
            <ul className={styles.chips}>
              {card.attribute && <li>{card.attribute}</li>}
              {card.level !== undefined && <li>Level {card.level}</li>}
              <li>{card.type}</li>
              <li className="capitalize">{card.frameType}</li>
            </ul>
            {isMonster && (card.atk !== undefined || card.def !== undefined) && (
              <p className={styles.stats}>
                {card.atk !== undefined && <span>ATK {card.atk}</span>}
                {card.def !== undefined && <span>DEF {card.def}</span>}
              </p>
            )}
            <p className={styles.text} tabIndex={dismissible ? 0 : undefined} role={dismissible ? "region" : undefined} aria-label={dismissible ? `${card.name} card text` : undefined}>{card.effectText}</p>
          </div>
        </div>
      </div>
    </>
  );
}
