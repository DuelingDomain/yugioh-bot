import { createRoot } from "react-dom/client";
import { useSyncExternalStore } from "react";
import { DuelRoomView } from "@/components/duel/room";
import { currentSlug, subscribeSlug } from "./side-deck-unready-next";
import "../app/globals.css";

/** The real duel room renders BetweenGamesScreen, then the next game after Ready again. */
function Harness() {
  const slug = useSyncExternalStore(subscribeSlug, currentSlug);
  return <DuelRoomView slug={slug} />;
}

createRoot(document.getElementById("root")!).render(<Harness />);
