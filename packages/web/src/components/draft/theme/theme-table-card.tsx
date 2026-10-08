"use client";

import * as React from "react";
import { Pencil } from "lucide-react";
import type { LobbyPlayer, LobbySnapshot } from "@yugidraft/shared/types";
import { Segmented, StatusLine, SvButton, SvCheck, svButtonClass } from "@/components/sheet";
import { cn } from "@/lib/utils";
import { LobbyActions, LobbyAutoStart, type LobbyController } from "../lobby/lobby-actions";
import { SeatMeter } from "../lobby/lobby-seats";
import { plural } from "../lobby/lobby-model";
import { formatPickSeconds } from "../pick-time";
import { suggestAssignments, type ThemeRulesPatch, type ThemeSelection, type ThemeTable, type ThemeTableConfig } from "./use-theme-table";
import styles from "./theme-table.module.css";

const SELECTION_LABELS: Record<ThemeSelection, string> = {
  player_pick: "Players pick",
  random: "Random",
  host_assigned: "Host assigns",
};

/** The Extra line. The theme Extra round is an up-to target: a thin pool can end it early. */
export function extraLine(config: ThemeTableConfig): string {
  if (config.extraDeckEnabled === false) return "Not drafted";
  return `Up to ${config.extraDeckSize ?? 15} picks`;
}

/** The one-line promise of the draft: what each player drafts, alone, from their own theme. */
export function draftLine(config: ThemeTableConfig): string {
  const main = `Main ${config.cardsPerPlayer ?? 40}`;
  const extra = config.extraDeckEnabled === false ? "" : ` + Extra: up to ${config.extraDeckSize ?? 15}`;
  return `${main}${extra}; ${plural(config.themePackSize ?? 3, "choice")} per pick`;
}

function selectionLine(selection: ThemeSelection, unique: boolean): string {
  return `${SELECTION_LABELS[selection]}${selection === "host_assigned" ? "" : unique ? ", all different" : ", can repeat"}`;
}

interface RulesFields {
  seats: number;
  selection: ThemeSelection;
  unique: boolean;
  main: number;
  choices: number;
  extraOn: boolean;
  extra: number;
  burn: boolean;
  copyLimit: boolean;
  seconds: number;
}

function fieldsOf(config: ThemeTableConfig): RulesFields {
  return {
    seats: config.lobbySeats ?? 4,
    selection: config.themeSelection ?? "player_pick",
    unique: config.uniqueThemes ?? true,
    main: config.cardsPerPlayer ?? 40,
    choices: config.themePackSize ?? 3,
    extraOn: config.extraDeckEnabled ?? true,
    extra: config.extraDeckSize ?? 15,
    burn: config.burnUnpicked ?? false,
    copyLimit: config.copyLimit ?? true,
    seconds: config.pickSeconds ?? 45,
  };
}

/** Only the fields the host changed, in the config's own names. */
function patchOf(saved: RulesFields, next: RulesFields): ThemeRulesPatch {
  const patch: ThemeRulesPatch = {};
  if (next.seats !== saved.seats) patch.lobbySeats = next.seats;
  if (next.selection !== saved.selection) patch.themeSelection = next.selection;
  if (next.unique !== saved.unique) patch.uniqueThemes = next.unique;
  if (next.main !== saved.main) patch.cardsPerPlayer = next.main;
  if (next.choices !== saved.choices) patch.themePackSize = next.choices;
  if (next.extraOn !== saved.extraOn) patch.extraDeckEnabled = next.extraOn;
  if (next.extra !== saved.extra) patch.extraDeckSize = next.extra;
  if (next.burn !== saved.burn) patch.burnUnpicked = next.burn;
  if (next.copyLimit !== saved.copyLimit) patch.copyLimit = next.copyLimit;
  if (next.seconds !== saved.seconds) patch.pickSeconds = next.seconds;
  return patch;
}

function NumberField({ id, label, value, min, max, disabled, onChange }: { id: string; label: string; value: number; min: number; max: number; disabled?: boolean; onChange: (n: number) => void }) {
  return (
    <div className={styles.fld}>
      <label className="label" htmlFor={id}>{label}</label>
      <input
        className="input"
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        disabled={disabled}
        value={Number.isFinite(value) ? value : ""}
        onChange={(e) => onChange(e.target.value === "" ? Number.NaN : Number(e.target.value))}
      />
    </div>
  );
}

/**
 * The host's theme rules. Edits stay pending until Save, then go in one request with the lobby revision. Choosing "Host
 * assigns" saves a whole assignment: seats without a theme get the next unused one from the box, and the host can change
 * each seat after that.
 */
function ThemeRulesEditor({ config, players, cubeIds, table, controller, locked, onClose }: {
  config: ThemeTableConfig;
  players: LobbyPlayer[];
  cubeIds: number[];
  table: ThemeTable;
  controller: LobbyController;
  locked: boolean;
  onClose: () => void;
}) {
  const ids = React.useId();
  const saved = React.useMemo(() => fieldsOf(config), [config]);
  const [fields, setFields] = React.useState(saved);
  const set = <K extends keyof RulesFields>(key: K, value: RulesFields[K]) => setFields((f) => ({ ...f, [key]: value }));
  const patch = patchOf(saved, fields);
  const changed = Object.keys(patch).length > 0;
  const valid = fields.seats >= 2 && fields.seats <= 8 && fields.main >= 20 && fields.choices >= 2 && fields.seconds >= 5 && (!fields.extraOn || fields.extra >= 1);
  const toHost = fields.selection === "host_assigned" && saved.selection !== "host_assigned";
  const suggested = toHost ? suggestAssignments(players, table.cubeOf, cubeIds, fields.unique) : null;
  const short = toHost && suggested === null;
  const busy = controller.pending !== null;

  const save = async () => {
    const full: ThemeRulesPatch = { ...patch };
    if (toHost && suggested) full.themeAssignments = suggested;
    if (await table.saveRules(full)) onClose();
  };

  return (
    <div className={styles.rules} role="group" aria-label="Theme rules">
      <div className={styles.fld}>
        <span className="label" id={`${ids}-sel`}>Theme selection</span>
        <Segmented
          label="Theme selection"
          value={fields.selection}
          options={(Object.keys(SELECTION_LABELS) as ThemeSelection[]).map((value) => ({ value, label: SELECTION_LABELS[value] }))}
          onChange={(value) => set("selection", value)}
          disabled={locked}
        />
      </div>
      <SvCheck compact label="Every player gets a different theme" checked={fields.unique} onChange={(e) => set("unique", e.target.checked)} disabled={locked} />
      <div className={styles.fieldRow}>
        <NumberField id={`${ids}-seats`} label="Seats" value={fields.seats} min={2} max={8} disabled={locked} onChange={(n) => set("seats", n)} />
        <NumberField id={`${ids}-main`} label="Main deck size" value={fields.main} min={20} max={120} disabled={locked} onChange={(n) => set("main", n)} />
        <NumberField id={`${ids}-choices`} label="Choices per pick" value={fields.choices} min={2} max={10} disabled={locked} onChange={(n) => set("choices", n)} />
        <NumberField id={`${ids}-secs`} label="Pick seconds" value={fields.seconds} min={5} max={300} disabled={locked} onChange={(n) => set("seconds", n)} />
      </div>
      <SvCheck compact label="Draft an Extra deck" checked={fields.extraOn} onChange={(e) => set("extraOn", e.target.checked)} disabled={locked} />
      {fields.extraOn && (
        <NumberField id={`${ids}-extra`} label="Extra deck, up to" value={fields.extra} min={1} max={15} disabled={locked} onChange={(n) => set("extra", n)} />
      )}
      <SvCheck compact label="Burn unpicked choices" checked={fields.burn} onChange={(e) => set("burn", e.target.checked)} disabled={locked} />
      <SvCheck compact label="Limit 3 copies per card" checked={fields.copyLimit} onChange={(e) => set("copyLimit", e.target.checked)} disabled={locked} />
      {short && (
        <p className={styles.rulesNote} role="status">Add more themes to the box first. Each player needs one to be assigned.</p>
      )}
      {toHost && suggested && players.some((p) => table.cubeOf(p.playerId) === null) && (
        <p className={styles.rulesNote}>Seats without a theme get one from the box. You can change each seat after saving.</p>
      )}
      <div className={styles.rulesActs}>
        <SvButton variant="primary" disabled={!changed || !valid || short || busy || locked} aria-busy={controller.pending === "rules" || undefined} onClick={() => void save()}>
          Save rules
        </SvButton>
        <SvButton variant="quiet" onClick={onClose}>Discard changes</SvButton>
      </div>
    </div>
  );
}

export interface ThemeTableCardProps {
  slug: string;
  name: string;
  config: ThemeTableConfig;
  lobby: LobbySnapshot;
  players: LobbyPlayer[];
  cubeIds: number[];
  table: ThemeTable;
  controller: LobbyController;
  isHost: boolean;
  isMember: boolean;
  /** An extra reason Start is off, for example a seat that still has no theme. */
  blocker: string | null;
  onJoin?: () => Promise<void>;
  onExpire?: () => void;
  /** The server's `canJoin`. Default on. */
  canJoin?: boolean;
  /** Open the invite dialog. Absent when the viewer has no link to share (a private draft they do not host). */
  onInvite?: () => void;
  inviteRef?: React.Ref<HTMLButtonElement>;
}

/**
 * The table card: the rules in plain rows, what is wrong with the setup, the seat numbers, and the lobby actions
 * (Ready, Start, the start box, auto-start). The host can edit the theme rules here; nobody else can.
 */
export function ThemeTableCard({ name, config, lobby, players, cubeIds, table, controller, isHost, isMember, blocker, onJoin, canJoin = true, onExpire, onInvite, inviteRef }: ThemeTableCardProps) {
  const [editing, setEditing] = React.useState(false);
  const selection = config.themeSelection ?? "player_pick";
  const unique = config.uniqueThemes ?? true;
  const locked = lobby.start !== null;
  const { errors, warnings } = table.preflight;
  const rows: Array<{ label: string; value: string }> = [
    { label: "Seats", value: lobby.targetSeats === null ? `${lobby.joined} joined` : `${lobby.joined} of ${lobby.targetSeats}` },
    { label: "Themes", value: selectionLine(selection, unique) },
    { label: "Main deck", value: `${config.cardsPerPlayer ?? 40} picks` },
    { label: "Extra deck", value: extraLine(config) },
    { label: "Each pick", value: `${plural(config.themePackSize ?? 3, "choice")}` },
    { label: "Pick time", value: formatPickSeconds(config.pickSeconds ?? 45) },
    { label: "Passed cards", value: config.burnUnpicked ? "Gone for good" : "Can come back" },
    { label: "Copy limit", value: config.copyLimit === false ? "Off" : "3 per card" },
  ];
  return (
    <section className={styles.card} aria-labelledby="theme-card-h">
      <header className={styles.cardHead}>
        <p className={styles.eyebrow}>Table card</p>
        <h2 id="theme-card-h" className={styles.cardT}>{name}</h2>
        <p className={styles.cardLine}>{draftLine(config)}</p>
      </header>

      <dl className={styles.sum}>
        {rows.map((row) => (
          <div key={row.label} className={styles.sumRow}>
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>

      {isHost && !editing && (
        <SvButton variant="ghost" wide disabled={locked} onClick={() => setEditing(true)}>
          <Pencil size={15} aria-hidden="true" />Edit theme rules
        </SvButton>
      )}
      {isHost && editing && (
        <ThemeRulesEditor config={config} players={players} cubeIds={cubeIds} table={table} controller={controller} locked={locked} onClose={() => setEditing(false)} />
      )}

      {errors.length > 0 && (
        <div className={styles.problems} role="alert">
          {errors.map((message) => <StatusLine key={message} tone="block">{message}</StatusLine>)}
        </div>
      )}
      {warnings.length > 0 && (
        <div className={styles.problems} role="status">
          {warnings.map((message) => <StatusLine key={message} tone="warn">{message}</StatusLine>)}
        </div>
      )}

      <SeatMeter lobby={lobby} />
      <div className={cn(styles.cardActs)}>
        {onInvite && (
          <button ref={inviteRef} type="button" className={svButtonClass("ghost", { wide: true })} onClick={onInvite}>Invite players</button>
        )}
        <LobbyAutoStart lobby={lobby} controller={controller} isHost={isHost} />
        <LobbyActions
          lobby={lobby}
          players={players}
          controller={controller}
          isHost={isHost}
          isMember={isMember}
          onJoin={onJoin}
          canJoin={canJoin}
          onExpire={onExpire}
          blocker={blocker}
        />
      </div>
    </section>
  );
}
