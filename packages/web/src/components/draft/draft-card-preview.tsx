"use client";

import { cardImageUrl } from "@/lib/card-image-url";
import Image from "next/image";
import { useState } from "react";
import { useDraftStore } from "@/lib/stores/draft-store";
import { cn } from "@/lib/utils";

interface DraftCardPreviewProps {
  className?: string;
}

export function DraftCardPreview({ className }: DraftCardPreviewProps) {
  const currentPack = useDraftStore((s) => s.currentPack);
  const previewCardId = useDraftStore((s) => s.previewCardId);
  const [imageErrors, setImageErrors] = useState<Set<number>>(new Set());
  const previewCard = currentPack.find((card) => card.id === previewCardId) ?? null;

  if (!previewCard) return null;

  return (
    <div
      data-testid="draft-card-preview"
      className={cn(
        "pointer-events-none fixed bottom-[5.625rem] left-[17.5rem] z-30 hidden w-[calc(14.5rem+max(0px,(100vw-114rem)/2))] max-w-[30.45rem] rounded-xl border border-border bg-surface p-2 shadow-card 2xl:block",
        className
      )}
      aria-label="Card preview"
    >
      <div
        data-testid="draft-card-preview-art"
        className="card-frame aspect-[421/614] w-full bg-bg-elevated"
      >
        {imageErrors.has(previewCard.id) ? (
          <div className="flex h-full items-center justify-center text-sm text-text-secondary">
            No image
          </div>
        ) : (
          <Image
            data-testid="draft-card-preview-image"
            src={cardImageUrl(previewCard.passcode)}
            unoptimized
            alt={previewCard.name}
            fill
            priority
            className="object-contain"
            sizes="(min-width: 146rem) 30.45rem, (min-width: 114rem) calc(14.5rem + (100vw - 114rem) / 2), (min-width: 96rem) 14.5rem, 0px"
            onError={() => setImageErrors((prev) => new Set(prev).add(previewCard.id))}
          />
        )}
      </div>
    </div>
  );
}
