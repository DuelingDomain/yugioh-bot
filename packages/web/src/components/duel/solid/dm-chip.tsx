"use client";

import { createContext, useContext } from "react";
import type { DuelPromptOption, DuelSeatView } from "@yugidraft/shared/duels";
import { cardArtUrl } from "../constants";
import { useIsNarrow } from "../side-panel";
import docks from "./docks.module.css";
import { SvIcon } from "./icons";

/**
 * What the chip needs to show your Deck Master action (the "Summon" button). `DuelRoomView` builds the same
 * `legalActionsFor` and `onChooseAction` for `MasterDock`; the Solid room hands them down here, so the chip and the
 * dock offer the very same actions. Without a provider the chip has no action button.
 */
export type DmChipActions = {
  /** The legal Deck Master actions for this seat's master card (empty when you cannot act). */
  actionsFor: (view: DuelSeatView) => DuelPromptOption[];
  onChoose: (option: DuelPromptOption) => void;
};
export const DmChipActionsContext = createContext<DmChipActions | null>(null);

type Status = "zone" | "field" | "away";

/** Where the master is: in the Deck Master Zone, on the field, or somewhere else (hand, graveyard ...). */
function chipStatus(view: DuelSeatView): Status {
  const master = view.deckMaster;
  if (!master) return "away";
  if (master.inZone) return "zone";
  const code = master.card.code;
  const onField = [...view.monsters, ...view.spells].some((card) => card?.code === code);
  return onField ? "field" : "away";
}

const STATUS_TEXT: Record<Status, string> = { zone: "In DM Zone", field: "On field", away: "Away" };
const STATUS_LONG: Record<Status, string> = { zone: "In Deck Master Zone", field: "On field", away: "Elsewhere" };

/**
 * The Deck Master chip on a mobile rail (domain duels only). Tapping it opens the Deck Masters sheet.
 * When you can act it also shows a 36px "Summon" button with the V1 action.
 *
 * While the docks aside is hidden (narrow screens), the thumb carries `data-master-dock` so `MasterReturnFx` still
 * finds a visible dock. On wide screens the dock keeps the hook and the chip (hidden by the rail) leaves it off.
 */
export function DmChip({ seat, view, mine, onOpen }: { seat: number; view: DuelSeatView | undefined; mine: boolean; onOpen: () => void }) {
  const narrow = useIsNarrow();
  const env = useContext(DmChipActionsContext);
  const master = view?.deckMaster;
  if (!view || !master) return null;
  const status = chipStatus(view);
  const away = status !== "zone";
  const action = mine && !away ? (env?.actionsFor(view)[0] ?? null) : null;
  const who = mine ? "Your Master" : "Opp. Master";
  return (
    <div className={docks.dmChip} data-away={away ? "true" : "false"} data-can-act={action ? "true" : "false"} data-side={mine ? "you" : "opp"}>
      <button type="button" className={docks.chipMain} data-sv-dm-chip={seat} onClick={onOpen}
        aria-label={`${mine ? "Your" : "Opponent"} Master, ${master.card.name}, ${STATUS_LONG[status]}, Returns ${master.returns}, Next surcharge ${master.nextCost} LP. Open details`}>
        <span className={docks.chipArt} data-master-dock={narrow ? seat : undefined} data-away={status === "away" ? "true" : "false"}>
          <img src={cardArtUrl(master.card.code)} alt="" draggable={false} />
        </span>
        <span className={docks.chipName}>{who}</span>
        <span className={docks.chipStatus}>{STATUS_TEXT[status]} · R {master.returns}</span>
      </button>
      {action ? (
        <button type="button" className={docks.chipAct} onClick={() => env?.onChoose(action)}>
          <SvIcon name="summon" size={13} />
          Summon
        </button>
      ) : null}
    </div>
  );
}
