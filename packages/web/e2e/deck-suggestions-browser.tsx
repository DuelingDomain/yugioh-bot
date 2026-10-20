import { createRoot } from "react-dom/client";
import { SavedDeckEditor } from "@/components/decks/editor";
import { EffectSearchProvider } from "@/components/effect-search/capability-context";
import "../app/globals.css";

const params = new URLSearchParams(window.location.search);

/** The real deck editor. The harness stands in for the app shell's side rail (236px from 820px up) and the server flags. */
function Harness() {
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
