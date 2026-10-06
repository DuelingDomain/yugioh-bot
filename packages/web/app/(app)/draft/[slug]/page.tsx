"use client";

import { parseUserId } from "@/lib/user-id";

import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { DraftManageView } from "@/components/draft/draft-manage-view";
import { DraftState } from "@/components/draft/draft-state";
import { DraftSummaryView } from "@/components/draft/draft-summary-view";
import { DraftRoom } from "@/components/draft/room/draft-room";
import { DraftFinale } from "@/components/draft/room/finale";
import { useDraftTournament } from "@/components/draft/use-draft-tournament";
import { useDraftStore } from "@/lib/stores/draft-store";
import { useDraftWebsocket } from "@/lib/hooks/use-draft-websocket";
import { useDraftCountdown } from "@/lib/hooks/use-draft-countdown";
import { useDraftExpiryResync } from "@/lib/hooks/use-draft-expiry-resync";
import { usePoolImagePrefetch } from "@/lib/hooks/use-pool-image-prefetch";

const DRAFT_STATUS = {
  active: "active",
  completed: "completed",
} as const;

interface DraftPlayer {
  playerId: number;
  displayName: string;
  seatIndex?: number;
  pickCount: number;
  finishedAt?: string;
  joinedAt: string;
}

interface DraftData {
  id: number;
  name: string;
  status: string;
  createdByUserId: number;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  currentPackRound?: number;
  currentPickStep?: number;
  config: {
    packSize?: number;
    packsPerPlayer?: number;
    cardsPerPlayer?: number;
    pickSeconds?: number;
    setNames?: string[];
    customCardIds?: number[];
    mode?: "booster" | "theme";
    themeSelection?: "host_assigned" | "random" | "player_pick";
    uniqueThemes?: boolean;
    extraDeckEnabled?: boolean;
    extraDeckSize?: number;
    alternatePassDirection?: boolean;
    themePackSize?: number;
  };
  phase?: "main" | "extra";
  themeProgress?: { main: number; mainTotal: number; extra: number; extraTotal: number };
  allowedCubes?: Array<{
    id: number;
    name: string;
    archetype: string | null;
    mainCount: number;
    extraCount: number;
    sampleImages: string[];
  }>;
  players: DraftPlayer[];
  playerCount: number;
  participantPickCount?: number;
  tournamentId?: number | null;
  tournamentName?: string | null;
  tournamentSlug?: string | null;
  myDeckId?: number | null;
  /** Server-checked: completed, no tournament yet, and the viewer is the host or a guild admin. */
  canCreateTournament?: boolean;
  isParticipant: boolean;
  /** Server says test bots are allowed (DRAFT_TEST_BOTS=1 or a non-production build). */
  botsEnabled?: boolean;
  currentPack?: Array<{
    id: number;
    passcode: number;
    name: string;
    type: string;
    frameType: string;
    attribute?: string;
    level?: number;
    effectText: string;
    atk?: number;
    def?: number;
    imageUrl: string;
    imageUrlSmall: string;
  }>;
  myPool?: Array<{
    id: number;
    passcode: number;
    name: string;
    type: string;
    frameType: string;
    attribute?: string;
    level?: number;
    effectText: string;
    atk?: number;
    def?: number;
    imageUrl: string;
    imageUrlSmall: string;
  }>;
  seats?: Array<{
    seatIndex: number;
    playerId: number;
    displayName: string;
    hasPicked: boolean;
    isCurrentPlayer: boolean;
  }>;
  packRound?: number;
  pickStep?: number;
  timerSeconds?: number;
  isMyTurn?: boolean;
  completed?: boolean;
  pickSeconds?: number;
}

export default function DraftDetailPage() {
  const params = useParams();
  const router = useRouter();
  const slug = typeof params.slug === "string" ? params.slug : "";

  const [draft, setDraft] = useState<DraftData | null>(null);
  const [error, setError] = useState<{ status: number | null } | null>(null);
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);

  // The room is shown while the draft is active; finishing it from the room ends on the finale.
  const [wasInRoom, setWasInRoom] = useState(false);
  const [finaleClosed, setFinaleClosed] = useState(false);
  const [finaleExporting, setFinaleExporting] = useState(false);
  const [finaleExportError, setFinaleExportError] = useState<string | null>(null);

  // The tournament made from this draft, shared with the finale (and the results page).
  const tournament = useDraftTournament(slug, {
    tournamentId: draft?.tournamentId,
    tournamentName: draft?.tournamentName,
    tournamentSlug: draft?.tournamentSlug,
  });

  const setFromServer = useDraftStore((s) => s.setFromServer);
  const storeCompleted = useDraftStore((s) => s.completed);
  // Live drafted count (updates optimistically on each pick), so the theme phase
  // indicator stays in lock-step with the Your Pool / DRAFTED counters.
  const storePool = useDraftStore((s) => s.myPool);

  const loadedRef = useRef(false);
  // A new draft address starts unloaded, so a failed first load of it shows the error sheet.
  useEffect(() => {
    loadedRef.current = false;
  }, [slug]);

  const fetchDraft = useCallback(async () => {
    try {
      const res = await fetch(`/api/drafts/${slug}`);
      if (!res.ok) {
        if (res.status === 401) {
          router.push("/login");
          return;
        }
        // A server fault on a refresh keeps the room on screen; the next refresh brings it back up to date.
        if (res.status >= 500 && loadedRef.current) return;
        setError({ status: res.status });
        return;
      }
      const data = await res.json();
      if (data.status === DRAFT_STATUS.active) {
        setFromServer({
          slug,
          packRound: data.packRound ?? data.currentPackRound ?? 1,
          pickStep: data.pickStep ?? data.currentPickStep ?? 1,
          currentPack: data.currentPack ?? [],
          myPool: data.myPool ?? [],
          seats: data.seats ?? [],
          timerSeconds: data.timerSeconds ?? 0,
          isMyTurn: data.isMyTurn ?? false,
          completed: data.completed ?? false,
          pickSeconds: data.pickSeconds ?? data.config?.pickSeconds ?? 60,
        });
      }
      setDraft(data);
      loadedRef.current = true;
      setError(null);
    } catch {
      if (!loadedRef.current) setError({ status: null });
    }
  }, [setFromServer, slug, router]);

  useDraftWebsocket(slug, {
    onStatusChange: (status) => {
      if (status === DRAFT_STATUS.completed) return;
      void fetchDraft();
    },
    onResync: () => {
      void fetchDraft();
    },
    onSeatsChange: () => {
      void fetchDraft();
    },
  });
  useDraftCountdown();
  useDraftExpiryResync(slug);
  usePoolImagePrefetch(slug, draft?.status === "active");

  useEffect(() => {
    fetch("/api/auth/session")
      .then((r) => r.json())
      .then((s) => {
        setCurrentUserId(parseUserId(s?.user?.id));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchDraft();
  }, [fetchDraft]);

  useEffect(() => {
    if (draft?.status === DRAFT_STATUS.active) setWasInRoom(true);
  }, [draft?.status]);

  useEffect(() => {
    if (storeCompleted && draft?.status === DRAFT_STATUS.active) {
      void fetchDraft();
    }
  }, [storeCompleted, draft?.status, fetchDraft]);

  const handleStart = async () => {
    const res = await fetch(`/api/drafts/${slug}`, { method: "POST" });
    if (!res.ok) {
      const body = await res.json();
      throw new Error(body.error ?? "Failed to start draft");
    }
    await fetchDraft();
    router.refresh();
  };

  const handleCancel = async () => {
    const res = await fetch(`/api/drafts/${slug}`, { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json();
      throw new Error(body.error ?? "Failed to cancel draft");
    }
    await fetchDraft();
  };

  const handleUpdate = async (data: { name?: string; config?: unknown }) => {
    const res = await fetch(`/api/drafts/${slug}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const body = await res.json();
      throw new Error(body.error ?? "Failed to update draft");
    }
    await fetchDraft();
  };

  const handleDelete = async () => {
    const res = await fetch(`/api/drafts/${slug}`, { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json();
      throw new Error(body.error ?? "Failed to delete draft");
    }
    router.push("/drafts");
  };

  const handleExportYdk = async (): Promise<string> => {
    const res = await fetch(`/api/drafts/${slug}/export`);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      const serverError = typeof body?.error === "string" ? body.error.trim() : "";
      throw new Error(serverError || "Failed to export deck", { cause: serverError || undefined });
    }
    return res.text();
  };

  if (error || !draft) {
    return <DraftState slug={slug} error={error} onRetry={() => void fetchDraft()} />;
  }

  const isCreator = currentUserId === draft.createdByUserId;
  const isParticipant = draft.isParticipant;

  const handleJoin = async () => {
    const res = await fetch(`/api/drafts/${slug}/join`, { method: "POST" });
    if (!res.ok) {
      const body = await res.json();
      throw new Error(body.error ?? "Failed to join draft");
    }
    await fetchDraft();
  };

  const handleAddBot = async () => {
    const res = await fetch(`/api/drafts/${slug}/join-bot`, { method: "POST" });
    if (!res.ok) {
      const body = await res.json();
      throw new Error(body.error ?? "Failed to add bot");
    }
    await fetchDraft();
  };

  const isThemeDraft = draft.config.mode === "theme";

  if (draft.status === "pending") {
    return (
      <DraftManageView
        draft={draft}
        slug={slug}
        isCreator={isCreator}
        isParticipant={isParticipant}
        onStart={handleStart}
        onCancel={handleCancel}
        onUpdate={handleUpdate}
        onJoin={handleJoin}
        onAddBot={handleAddBot}
        onChanged={() => void fetchDraft()}
        botsEnabled={draft.botsEnabled === true}
      />
    );
  }

  if (draft.status === "active") {
    return (
      <DraftRoom slug={slug} name={draft.name} config={draft.config} isParticipant={isParticipant} />
    );
  }

  const finalePool = draft.status === DRAFT_STATUS.completed && draft.myPool?.length ? draft.myPool : storePool;
  const showFinale = wasInRoom && !finaleClosed && draft.status === DRAFT_STATUS.completed && isParticipant && finalePool.length > 0;
  const finaleExtra = isThemeDraft ? Math.max(0, finalePool.length - (draft.config.cardsPerPlayer ?? 40)) : 0;
  const downloadYdk = async () => {
    if (finaleExporting) return;
    setFinaleExporting(true);
    setFinaleExportError(null);
    try {
      const ydk = await handleExportYdk();
      const url = URL.createObjectURL(new Blob([ydk], { type: "text/plain" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${draft.name.replace(/\s+/g, "_")}.ydk`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      const serverError = err instanceof Error && typeof err.cause === "string" ? err.cause : "";
      const detail = serverError ? ` ${serverError}${serverError.endsWith(".") ? "" : "."}` : "";
      setFinaleExportError(`Couldn't export the YDK file.${detail}`);
    } finally {
      setFinaleExporting(false);
    }
  };

  return (
    <div>
      <DraftSummaryView
        draft={draft}
        slug={slug}
        isParticipant={isParticipant}
        isCreator={isCreator}
        onExportYdk={handleExportYdk}
        onDelete={handleDelete}
        myPool={draft.myPool}
        tournament={tournament}
      />
      {showFinale && (
        <DraftFinale
          slug={slug}
          pool={finalePool}
          theme={isThemeDraft}
          extraCount={finaleExtra}
          canCreateTournament={draft.canCreateTournament === true}
          tournament={tournament}
          exporting={finaleExporting}
          exportError={finaleExportError}
          onExport={() => void downloadYdk()}
          onClose={() => setFinaleClosed(true)}
        />
      )}
    </div>
  );
}
