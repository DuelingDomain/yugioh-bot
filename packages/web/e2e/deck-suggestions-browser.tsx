import { createRoot } from "react-dom/client";
import { useState } from "react";
import { SavedDeckEditor } from "@/components/decks/editor";
import { SuggestionsPanel } from "@/components/decks/suggestions-panel";
import { EffectSearchProvider } from "@/components/effect-search/capability-context";
import "../app/globals.css";

const params = new URLSearchParams(window.location.search);
const poolDeck = { main: [89631139], extra: [], side: [] };
function PoolHarness() {
  const [pool, setPool] = useState([89631139, 87025064]);
  return <div style={{ width: 500 }}>
    <button onClick={() => setPool(now => [...now].reverse())}>Reorder pool</button>
    <button onClick={() => setPool([89631139, 23995346])}>Replace pool card</button>
    <SuggestionsPanel active suggest={{ deck: poolDeck }} mode="normal" genesys={false} pool={pool}
      cardProps={() => ({})} deckCount={() => 0} limit={() => 3} onCatalog={() => {}} />
  </div>;
}

/** The real deck editor. The harness stands in for the app shell's side rail (236px from 820px up) and the server flags. */
function Harness() {
  if (params.get("scenario") === "pool") return <PoolHarness />;
  return (
    <EffectSearchProvider enabled suggestionsEnabled={params.get("flag") !== "off"}>
      <div style={{ display: "flex" }}>
        <div className="harness-rail" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <SavedDeckEditor deckId={params.get("deck") ?? undefined} />
        </div>
      </div>
    </EffectSearchProvider>
  );
}

createRoot(document.getElementById("root")!).render(<Harness />);
