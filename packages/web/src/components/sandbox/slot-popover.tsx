"use client";

import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { Trash2, X } from "lucide-react";
import { SANDBOX_LIMITS, type SandboxCardEntry, type SandboxStance } from "@yugidraft/shared/duels";
import { cn } from "@/lib/utils";
import {
  allowedPositions,
  cardOf,
  defaultPos,
  isSlotZone,
  type CardLoc,
  type PileZone,
  type SandboxAction,
  type SlotZone,
} from "./board-model";
import { isXyz, zoneName } from "./placement";
import { CardThumb, specOf, type CardInfoMap } from "./zone-slot";
import styles from "./builder.module.css";

const SEND_TO: readonly { zone: PileZone; label: string }[] = [
  { zone: "hand", label: "Hand" },
  { zone: "grave", label: "GY" },
  { zone: "banished", label: "Banish" },
  { zone: "deck", label: "Deck top" },
  { zone: "extra", label: "Extra" },
];

const POS_LABEL: Record<SandboxStance, string> = { atk: "Attack", def: "Defense", set: "Set", up: "Face-up" };

/**
 * Small popover of a placed card: position, "properly summoned", Xyz materials, send to a pile, remove.
 * It opens inside the slot wrapper, so it needs no portal. It shifts to stay inside the window.
 */
export function CardPopover({
  loc,
  entry,
  infos,
  onAction,
  onClose,
  onAddMaterialByName,
  armedCode,
}: {
  loc: CardLoc;
  entry: SandboxCardEntry;
  infos: CardInfoMap;
  onAction: (action: SandboxAction) => void;
  onClose: () => void;
  /** Adds the top hit of a typed name as a material. Returns an error text, or null when it worked. */
  onAddMaterialByName: (loc: CardLoc, text: string) => Promise<string | null>;
  /** The card the user selected in the search, if any. */
  armedCode: number | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState({ dx: 0, up: false });
  const [text, setText] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const slot = isSlotZone(loc.zone);
  const spec = specOf(entry);
  const code = cardOf(entry);
  const info = infos.get(code);
  const name = info?.name ?? `Card ${code}`;
  const positions = slot ? allowedPositions(loc.zone) : [];
  const pos = slot ? (spec.pos ?? defaultPos(loc.zone as SlotZone)) : undefined;
  const materials = spec.materials ?? [];
  const showMaterials = loc.zone === "monster" && ((info ? isXyz(info) : false) || materials.length > 0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const margin = 8;
    let dx = 0;
    if (rect.right > window.innerWidth - margin) dx = window.innerWidth - margin - rect.right;
    if (rect.left + dx < margin) dx = margin - rect.left;
    const anchor = el.parentElement?.getBoundingClientRect();
    const up = rect.bottom > window.innerHeight - margin && (anchor?.top ?? 0) > rect.height + margin;
    setPlace((prev) => (prev.dx === dx && prev.up === up ? prev : { dx, up }));
  }, [materials.length, showMaterials, problem]);

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
    }
  }

  async function addMaterial() {
    const value = text.trim();
    if (!value || busy) return;
    setBusy(true);
    const error = await onAddMaterialByName(loc, value);
    setBusy(false);
    setProblem(error);
    if (!error) setText("");
  }

  return (
    <div
      ref={ref}
      className={styles.popover}
      role="dialog"
      aria-label={`${name} options`}
      data-up={place.up ? "true" : undefined}
      style={{ transform: `translateX(calc(-50% + ${place.dx}px))` }}
      onKeyDown={onKeyDown}
    >
      <div className={styles.popHead}>
        <CardThumb className={styles.popArt} code={code} name={name} />
        <div>
          <strong>{name}</strong>
          <span>{zoneName(loc.zone)}{slot && loc.zone !== "field" && loc.zone !== "deckMaster" ? ` ${loc.index + 1}` : ""}</span>
        </div>
        <button type="button" className={styles.iconBtn} aria-label="Close" onClick={onClose}><X size={14} aria-hidden /></button>
      </div>

      {positions.length > 0 ? (
        <div className={styles.popRow} role="group" aria-label="Position">
          {positions.map((value) => (
            <button
              key={value}
              type="button"
              className={styles.popChoice}
              aria-pressed={pos === value}
              onClick={() => onAction({ type: "setPosition", at: loc, pos: value })}
            >
              {POS_LABEL[value]}
            </button>
          ))}
        </div>
      ) : null}

      {loc.zone === "monster" ? (
        <label className={styles.popCheck}>
          <input
            type="checkbox"
            checked={spec.summoned !== false}
            onChange={(event) => onAction({ type: "setSummoned", at: loc, summoned: event.target.checked })}
          />
          Properly summoned
        </label>
      ) : null}

      {showMaterials ? (
        <div className={styles.popSection}>
          <span className={styles.popTitle}>Xyz materials <span className="num">{materials.length}/{SANDBOX_LIMITS.materials}</span></span>
          {materials.length > 0 ? (
            <ul className={styles.matList}>
              {materials.map((material, index) => (
                <li key={`${material}-${index}`}>
                  <span title={infos.get(material)?.name}>{infos.get(material)?.name ?? `Card ${material}`}</span>
                  <button type="button" className={styles.iconBtn} aria-label={`Remove material ${infos.get(material)?.name ?? material}`} onClick={() => onAction({ type: "removeMaterial", at: loc, index })}>
                    <X size={12} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <div className={styles.matAdd}>
            <input
              className="input"
              value={text}
              placeholder="Add material, Enter"
              aria-label="Add Xyz material by name"
              spellCheck={false}
              autoComplete="off"
              onChange={(event) => { setText(event.target.value); setProblem(null); }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void addMaterial();
                }
              }}
            />
            {armedCode !== null ? (
              <button type="button" className={cn("btn btn-quiet btn-sm", styles.matSelected)} onClick={() => onAction({ type: "addMaterial", at: loc, card: armedCode })}>
                Add selected
              </button>
            ) : null}
          </div>
          {problem ? <p className={styles.popProblem} role="alert">{problem}</p> : null}
        </div>
      ) : null}

      <div className={styles.popSection}>
        <span className={styles.popTitle}>Send to</span>
        <div className={styles.popRow}>
          {SEND_TO.filter((target) => !(target.zone === loc.zone)).map((target) => (
            <button
              key={target.zone}
              type="button"
              className={styles.popChoice}
              onClick={() => {
                onAction({ type: "move", from: loc, to: { seat: loc.seat, zone: target.zone, index: Number.MAX_SAFE_INTEGER } });
                onClose();
              }}
            >
              {target.label}
            </button>
          ))}
        </div>
      </div>

      <button
        type="button"
        className={cn("btn btn-danger btn-sm", styles.popRemove)}
        onClick={() => {
          onAction({ type: "remove", at: loc });
          onClose();
        }}
      >
        <Trash2 size={14} aria-hidden /> Remove
      </button>
    </div>
  );
}
