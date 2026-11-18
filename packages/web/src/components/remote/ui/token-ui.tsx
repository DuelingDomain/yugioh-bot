"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { RemoteActionProposal, RemoteRoom } from "@yugidraft/shared/remote";
import { searchCards, type CardInfo } from "./catalog";
import { cardCode, cardName, cellsFor, type TwinCard, type ZoneKey } from "./model";
import { BigArt, PopupFrame } from "./popup";
import type { Verdict } from "./placement";
import type { useLayers } from "./use-layers";
import s from "./remote-ui.module.css";
import t from "./stats-tokens.module.css";
import { playerStamp } from "@/lib/remote/field-timing";

type Act = (action: RemoteActionProposal) => Promise<RemoteRoom | null>;
type Position = "attack" | "defense";
const CENTER = { anchor: null, feed: null };
const MAIN = ["m1", "m2", "m3", "m4", "m5"] as const;
const MAX = 999_999;

/** Only Main Monster Zones 1-5 hold a token, never an Extra Monster Zone. */
const isMainCell = (key: ZoneKey) => (MAIN as readonly string[]).includes(key);
const zoneLabel = (key: ZoneKey) => `Monster Zone ${key[1]}`;
const points = (text: string) => { const n = Number(text); return text.trim() !== "" && Number.isInteger(n) && n >= 0 && n <= MAX ? n : null; };

type View = { kind: "new"; seat: number; key: ZoneKey | null } | { kind: "template" } | { kind: "card"; seat: number; ref: string; };
/** What the next click on a free Monster Zone puts there. */
export type TokenTemplate = { name: string; atk: number; def: number; artId?: number; position: Position };
const GENERIC: TokenTemplate = { name: "Token", atk: 0, def: 0, position: "attack" };
/** Cards that give a named token to a player. A card on the table with one of these names offers its token first. Nothing else is guessed. */
const TOKEN_OF: Record<string, { name: string; atk: number; def: number }> = {
  "nibiru, the primal being": { name: "Primal Being Token", atk: 2000, def: 2000 },
  "scapegoat": { name: "Sheep Token", atk: 0, def: 0 },
  "ojama trio": { name: "Ojama Token", atk: 0, def: 1000 },
  "dandylion": { name: "Fluff Token", atk: 0, def: 0 },
};
const OFF_FIELD = ["hand", "deck", "extra"];

/**
 * Tokens on a Remote Duels table: a token is table state with no physical card. The owner creates it from the "Token" button
 * or from an empty Main Monster Zone's menu, and moves, turns or removes it from its popup. The camera never reads it.
 */
export function useTokens({ act, room, live, extraZones, layers, info }: {
  act: Act; room: RemoteRoom; live: boolean; extraZones: boolean; layers: ReturnType<typeof useLayers>; info: (id: number | undefined) => CardInfo | undefined;
}) {
  const [view, setView] = useState<View | null>(null);
  const [placing, setPlacing] = useState<TokenTemplate | null>(null);
  const { solo, mySeat } = room;
  const owns = useCallback((seat: number) => live && (solo || seat === mySeat), [live, solo, mySeat]);
  /** Any seated player (not a spectator) may put a token on any field. */
  const canPlace = live && (solo || (mySeat >= 0 && !room.spectator));
  const actor = (seat: number) => solo ? seat : mySeat;
  const names = room.state.seats.flatMap(item => item.twin.filter(card => card.faceUp && !card.token && !OFF_FIELD.includes(card.zone)).map(card => cardName(card, info(cardCode(card))).toLowerCase()));
  const offered = [...new Set(names.filter(name => TOKEN_OF[name]))].map(name => TOKEN_OF[name]);
  const offeredKey = offered.map(item => item.name).join("|");
  const [art, setArt] = useState<Record<string, number>>({});
  // The token's art comes from the catalog when it is there. The chip works without it.
  useEffect(() => {
    let on = true;
    for (const name of offeredKey ? offeredKey.split("|") : []) void searchCards(name, false).then(list => {
      const hit = list.find(card => card.name === name && /token/i.test(card.type));
      if (on && hit) setArt(old => old[name] === hit.id ? old : { ...old, [name]: hit.id });
    });
    return () => { on = false; };
  }, [offeredKey]);
  const suggestions: TokenTemplate[] = offered.map(item => ({ ...item, position: "attack" as const, ...(art[item.name] ? { artId: art[item.name] } : {}) }));
  useEffect(() => { if (placing && !canPlace) setPlacing(null); }, [placing, canPlace]);
  useEffect(() => {
    if (!placing) return;
    const stop = (event: KeyboardEvent) => { if (event.key === "Escape" && !layers.layer) { event.preventDefault(); event.stopPropagation(); setPlacing(null); } };
    window.addEventListener("keydown", stop, true);
    return () => window.removeEventListener("keydown", stop, true);
  }, [placing, layers.layer]);
  const freeKeys = useCallback((seat: number, keys: readonly ZoneKey[]) => {
    const cells = cellsFor(room.state.seats[seat]?.twin ?? [], extraZones);
    return keys.filter(key => !cells[key]?.card);
  }, [room.state.seats, extraZones]);

  /** The create dialog. An empty Main Monster Zone passes its cell, the button leaves it open. */
  const create = useCallback((seat: number, key?: ZoneKey) => {
    if (!owns(seat) || key && !isMainCell(key)) return false;
    setView({ kind: "new", seat, key: key ?? null }); layers.open("token"); return true;
  }, [owns, layers]);
  /** The "Token" control: starts placing a generic token, or cancels when already placing. */
  const toggle = () => { if (placing) setPlacing(null); else if (canPlace) setPlacing(GENERIC); };
  /** A click on a zone while placing. A free Main Monster Zone on a living seat gets the token; anything else keeps its usual click. */
  const placeAt = (seat: number, key: ZoneKey, card: TwinCard | undefined): boolean => {
    if (!placing || !canPlace) return false;
    const target = room.state.seats[seat];
    if (!target || target.eliminated || card || !isMainCell(key)) return false;
    place(seat, { name: placing.name, atk: placing.atk, def: placing.def, artId: placing.artId, position: placing.position, key });
    return true;
  };
  const customize = () => { setView({ kind: "template" }); layers.open("token"); };
  const open = useCallback((seat: number, card: TwinCard) => { setView({ kind: "card", seat, ref: card.ref }); layers.open("token"); }, [layers]);
  const close = () => { layers.close("token"); setView(null); };

  const place = (seat: number, draft: { name: string; atk: number; def: number; artId?: number; position: Position; key: ZoneKey }) => {
    void act({ type: "twin.place", actorSeat: actor(seat), seat, zone: "monster", card: { ref: crypto.randomUUID(), name: draft.name, slot: Number(draft.key[1]), faceUp: true, position: draft.position,
      token: { atk: draft.atk, def: draft.def, ...(draft.artId ? { artId: draft.artId } : {}) } } });
    setPlacing(null); close();
  };
  const moveTo = (seat: number, card: TwinCard, key: ZoneKey) => {
    void act({ type: "twin.move", actorSeat: actor(seat), seat, zone: "monster", slot: Number(key[1]), cardRef: card.ref });
  };
  const turn = (seat: number, card: TwinCard) => void act({ type: "twin.flip", actorSeat: actor(seat), seat, cardRef: card.ref, faceUp: true, position: card.position === "defense" ? "attack" : "defense" });
  const remove = (seat: number, card: TwinCard) => { void act({ type: "twin.remove", actorSeat: actor(seat), seat, cardRef: card.ref, cam: playerStamp("token-remove") }); close(); };

  /** Drag and drop: a token only lands on a free Main Monster Zone cell. Leaving the field is Remove, so a drop elsewhere says so. */
  const judge = (seat: number, card: TwinCard, key: ZoneKey | "hand"): Verdict => {
    if (key === "hand" || !isMainCell(key)) return { kind: "refuse", message: "A token stays in the Main Monster Zones. Use Remove to take it off the field." };
    const cells = cellsFor(room.state.seats[seat]?.twin ?? [], extraZones);
    if (cells[key]?.card?.ref === card.ref) return { kind: "same" };
    return cells[key]?.card ? { kind: "refuse", message: "That zone is taken." } : { kind: "ok" };
  };
  const drop = (seat: number, card: TwinCard, key: ZoneKey | "hand") => { if (key !== "hand" && judge(seat, card, key).kind === "ok") moveTo(seat, card, key); };

  const trigger = (seat: number): ReactNode => canPlace && seat === (solo ? 0 : mySeat)
    ? <button type="button" className={`${s.btn} ${s.sm} ${placing ? s.go : ""}`} aria-pressed={!!placing} onClick={toggle} data-testid={`token-open-${seat}`}
      title="Put a token on any free Monster Zone, yours or an opponent's. The camera does not read it.">Token</button> : null;

  const card = view?.kind === "card" ? room.state.seats[view.seat]?.twin.find(item => item.ref === view.ref) : undefined;
  const isCreator = (card: TwinCard) => mySeat >= 0 && card.token?.by === mySeat;
  const dialog = layers.layer === "token" && view ? view.kind === "new"
    ? <TokenDialog free={freeKeys(view.seat, MAIN)} start={view.key} onCreate={draft => place(view.seat, { ...draft, key: draft.key! })} onClose={close} />
    : view.kind === "template" ? <TokenDialog free={[]} start={null} zoneless onCreate={draft => { setPlacing({ name: draft.name, atk: draft.atk, def: draft.def, artId: draft.artId, position: draft.position }); close(); }} onClose={close} />
    : card?.token ? <TokenPopover card={card} editable={owns(view.seat) || (live && isCreator(card))} free={freeKeys(view.seat, MAIN)} art={info(card.token.artId)}
      onTurn={() => turn(view.seat, card)} onMove={key => moveTo(view.seat, card, key)} onRemove={() => remove(view.seat, card)} onClose={close} /> : null : null;
  const node = <>
    {placing && canPlace ? <TokenBar template={placing} suggestions={suggestions} onPick={setPlacing} onCustom={customize} onCancel={() => setPlacing(null)} /> : null}
    {dialog}
  </>;
  return { create, open, judge, drop, trigger, node, owns, placing: !!placing && canPlace, placeAt };
}

/** The strip shown while placing: what goes down, and how to stop. The zones themselves glow on the fields. */
function TokenBar({ template, suggestions, onPick, onCustom, onCancel }: {
  template: TokenTemplate; suggestions: TokenTemplate[]; onPick: (template: TokenTemplate) => void; onCustom: () => void; onCancel: () => void;
}) {
  const chip = (item: TokenTemplate, label: string) => <button key={label} type="button" className={`${s.btn} ${s.sm} ${template.name === item.name && template.atk === item.atk && template.def === item.def ? s.go : s.q}`}
    aria-pressed={template.name === item.name && template.atk === item.atk && template.def === item.def} onClick={() => onPick(item)} data-testid="token-chip">{label}</button>;
  return <div className={t.bar} role="status" data-testid="token-bar">
    <span className={t.barText}>Click a free Monster Zone for the <b>{template.name}</b>{template.atk || template.def ? ` (${template.atk}/${template.def})` : ""}.</span>
    <span className={t.barChips}>
      {suggestions.map(item => chip(item, item.name))}
      {suggestions.length ? chip(GENERIC, "Generic") : null}
      <button type="button" className={`${s.btn} ${s.sm} ${s.q}`} onClick={onCustom} data-testid="token-custom">Custom…</button>
      <button type="button" className={`${s.btn} ${s.sm} ${s.q}`} onClick={onCancel} data-testid="token-cancel">Cancel <kbd>Esc</kbd></button>
    </span>
  </div>;
}

function TokenDialog({ free, start, zoneless, onCreate, onClose }: {
  free: ZoneKey[]; start: ZoneKey | null;
  /** No zone is chosen here: the token is placed by the next click on a zone. */
  zoneless?: boolean;
  onCreate: (draft: { name: string; atk: number; def: number; artId?: number; position: Position; key?: ZoneKey }) => void; onClose: () => void;
}) {
  const [mode, setMode] = useState<"common" | "generic">("common");
  const [query, setQuery] = useState(""); const [found, setFound] = useState<CardInfo[] | null>(null); const [chosen, setChosen] = useState<CardInfo | null>(null);
  const [name, setName] = useState("Token"); const [atk, setAtk] = useState("0"); const [def, setDef] = useState("0");
  const [position, setPosition] = useState<Position>("attack");
  const [key, setKey] = useState<ZoneKey | "">(start && free.includes(start) ? start : free[0] ?? "");
  useEffect(() => {
    const text = query.trim(); if (text.length < 2) { setFound(null); return; }
    let on = true; const timer = setTimeout(() => { void searchCards(text, false).then(list => { if (on) setFound(list.filter(card => /token/i.test(card.type))); }); }, 200);
    return () => { on = false; clearTimeout(timer); };
  }, [query]);
  const draft = useMemo(() => {
    if (!key && !zoneless) return null;
    const at = key ? { key } : {};
    if (mode === "common") return chosen ? { name: chosen.name, atk: chosen.atk ?? 0, def: chosen.def ?? 0, artId: chosen.id, position, ...at } : null;
    const a = points(atk), d = points(def), label = name.trim().slice(0, 200);
    return label && a !== null && d !== null ? { name: label, atk: a, def: d, position, ...at } : null;
  }, [mode, chosen, atk, def, name, position, key, zoneless]);
  const typing = { onKeyDown: (event: React.KeyboardEvent) => { if (event.key !== "Escape") event.stopPropagation(); } };
  return <PopupFrame at={CENTER} layer="token" label="Create a token" testid="token-dialog">
    <form className={t.dialog} onSubmit={event => { event.preventDefault(); if (draft) onCreate(draft); }}>
      <h3>{zoneless ? "Custom token" : "Create a token"}</h3>
      <div className={t.seg} role="group" aria-label="Kind of token">
        <button type="button" className={`${s.btn} ${s.sm} ${mode === "common" ? s.go : s.q}`} aria-pressed={mode === "common"} onClick={() => setMode("common")} data-testid="token-mode-common">Common token</button>
        <button type="button" className={`${s.btn} ${s.sm} ${mode === "generic" ? s.go : s.q}`} aria-pressed={mode === "generic"} onClick={() => setMode("generic")} data-testid="token-mode-generic">Generic token</button>
      </div>
      {mode === "common" ? <>
        <label className={t.field}>Search the token by name
          <input className={t.num} style={{ width: "100%" }} type="text" autoComplete="off" placeholder="Sheep Token" value={query} data-autofocus data-testid="token-search" {...typing} onChange={event => { setQuery(event.target.value); setChosen(null); }} /></label>
        <div className={t.pick}>
          {found?.map(card => <button key={card.id} type="button" className={`${s.btn} ${s.sm} ${s.q}`} onClick={() => { setChosen(card); setQuery(card.name); setFound(null); }} data-testid="token-pick">{card.name} · ATK {card.atk ?? 0} / DEF {card.def ?? 0}</button>)}
          {found && !found.length ? <p className={t.note} role="status">No token with that name. Use a generic token.</p> : null}
        </div>
        {chosen ? <p className={t.chosen} data-testid="token-chosen">{chosen.name} · ATK {chosen.atk ?? 0} / DEF {chosen.def ?? 0}</p> : null}
      </> : <div className={t.row}>
        <label className={t.field}>Name<input className={t.num} style={{ width: 150 }} type="text" maxLength={200} value={name} data-autofocus data-testid="token-name" {...typing} onChange={event => setName(event.target.value)} /></label>
        <label className={t.field}>ATK<input className={t.num} inputMode="numeric" value={atk} aria-invalid={points(atk) === null} data-testid="token-atk" {...typing} onChange={event => setAtk(event.target.value)} /></label>
        <label className={t.field}>DEF<input className={t.num} inputMode="numeric" value={def} aria-invalid={points(def) === null} data-testid="token-def" {...typing} onChange={event => setDef(event.target.value)} /></label>
      </div>}
      <div className={t.row}>
        <div className={t.seg} role="group" aria-label="Position">
          <button type="button" className={`${s.btn} ${s.sm} ${position === "attack" ? s.go : s.q}`} aria-pressed={position === "attack"} onClick={() => setPosition("attack")} data-testid="token-attack">Attack</button>
          <button type="button" className={`${s.btn} ${s.sm} ${position === "defense" ? s.go : s.q}`} aria-pressed={position === "defense"} onClick={() => setPosition("defense")} data-testid="token-defense">Defense</button>
        </div>
        {zoneless ? null : free.length ? <label className={t.field}>Zone
          <select className={t.num} style={{ width: 150 }} value={key} data-testid="token-zone" onChange={event => setKey(event.target.value as ZoneKey)}>
            {free.map(item => <option key={item} value={item}>{zoneLabel(item)}</option>)}</select></label>
          : <p className={t.note} role="status">Every Main Monster Zone is taken.</p>}
      </div>
      <div className={t.row}>
        <button type="submit" className={`${s.btn} ${s.go}`} disabled={!draft} data-testid="token-create">{zoneless ? "Choose a zone" : "Create token"}</button>
        <button type="button" className={`${s.btn} ${s.q}`} onClick={onClose}>Cancel</button>
      </div>
    </form>
  </PopupFrame>;
}

function TokenPopover({ card, editable, free, art, onTurn, onMove, onRemove, onClose }: {
  card: TwinCard; editable: boolean; free: ZoneKey[]; art: CardInfo | undefined;
  onTurn: () => void; onMove: (key: ZoneKey) => void; onRemove: () => void; onClose: () => void;
}) {
  const [target, setTarget] = useState<ZoneKey | "">("");
  const token = card.token!; const defense = card.position === "defense";
  return <PopupFrame at={CENTER} layer="token" label={`${cardName(card, art)} token`} testid="token-popover">
    <div className={t.dialog}>
      {token.artId ? <BigArt id={token.artId} label={card.name} /> : null}
      <h3 data-testid="token-title">{cardName(card, art)}</h3>
      <p className={t.chosen}>Token · {defense ? "Defense" : "Attack"} position · ATK {token.atk} / DEF {token.def}</p>
      {editable ? <>
        <div className={t.row}>
          <button type="button" className={`${s.btn} ${s.sm}`} onClick={onTurn} data-testid="token-turn">{defense ? "Switch to Attack" : "Switch to Defense"}</button>
          <button type="button" className={`${s.btn} ${s.sm}`} onClick={() => { onRemove(); }} data-testid="token-remove">Remove token</button>
        </div>
        {free.length ? <div className={t.row}>
          <label className={t.field}>Move to
            <select className={t.num} style={{ width: 170 }} value={target} data-testid="token-move-zone" onChange={event => setTarget(event.target.value as ZoneKey)}>
              <option value="">Choose a zone</option>{free.map(item => <option key={item} value={item}>{zoneLabel(item)}</option>)}</select></label>
          <button type="button" className={`${s.btn} ${s.sm}`} disabled={!target} onClick={() => { if (target) { onMove(target); setTarget(""); } }} data-testid="token-move">Move</button>
        </div> : null}
      </> : null}
      <div className={t.row}><button type="button" className={`${s.btn} ${s.q}`} onClick={onClose}>Close</button></div>
    </div>
  </PopupFrame>;
}
