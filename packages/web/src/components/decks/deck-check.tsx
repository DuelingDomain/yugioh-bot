import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import { SectionHead, StatusLine } from "@/components/sheet";
import type { DuelDeck } from "@yugidraft/shared/duels";
import { MonsterLevelsChart } from "./levels-chart";
import { sectionBreakdown, type CardCatalog, type CopyProblem } from "./model";
import styles from "./editor.module.css";

export type DeckCheckProps = {
  problems: readonly CopyProblem[];
  notes: readonly string[];
  banlistName: string | null;
  flag: string;
  tone: "bad" | "warn" | "ok";
  pool: boolean;
  onProblem: (problem: CopyProblem) => void;
};

export function copyProblemText(problem: CopyProblem, banlistName: string | null): string {
  return `${problem.count} ${problem.count === 1 ? "copy" : "copies"}, ${problem.max === 0 ? "Forbidden" : `${problem.max} allowed${banlistName && problem.max < 3 ? ` on ${banlistName}` : ""}`}`;
}

const CHECK_TONE = { bad: "block", warn: "warn", ok: "ready" } as const;

/** The deck check: one status line with the verdict, then what to fix. No tinted box. */
export function DeckCheck({ problems, notes, banlistName, flag, tone, pool, onProblem }: DeckCheckProps) {
  const id = useId();
  return (
    <section className={styles["de-chk"]} data-s={tone} aria-labelledby={id}>
      <h2 className="sr" id={id}>Deck check</h2>
      <StatusLine tone={CHECK_TONE[tone]}><b>{flag}</b></StatusLine>
      {problems.length > 0 ? <ul className={styles["de-probs"]}>{problems.map((problem) => <li key={problem.key}><button type="button" onClick={() => onProblem(problem)}><span className={styles["de-pn"]}>{problem.name}</span>{" "}<span className={styles["de-pw"]}>{copyProblemText(problem, banlistName)}</span></button></li>)}</ul> : null}
      {notes.length > 0 ? <ul className={styles["de-guidance"]}>{notes.map((note) => <li key={note}>{note}</li>)}</ul> : null}
      <p className={styles["de-chk-n"]}>{pool ? "A draft deck needs its main deck size before it can be saved." : `On ${banlistName ?? "no banlist"}. You can save an unfinished deck. The table checks legality when you ready up.`}</p>
    </section>
  );
}

export function DeckSummary({ deck, catalog, emptyNew, ...check }: DeckCheckProps & { deck: DuelDeck; catalog: CardCatalog; emptyNew: boolean }) {
  const [tipsOpen, setTipsOpen] = useState(emptyNew);
  const parts = sectionBreakdown("main", deck.main, catalog);
  const id = useId();
  return (
    <div className={styles["de-sum"]}>
      <DeckCheck {...check} />
      <section className={styles["de-mix"]} aria-labelledby={id}>
        <SectionHead as="h3" id={id} title="What's in it" />
        <p className={styles["df-tally"]}>{["monster", "spell", "trap"].map((key) => <span key={key} data-k={key}><b>{parts.find((part) => part.key === key)?.count ?? 0}</b>{" "}{key === "monster" ? "Monsters" : key === "spell" ? "Spells" : "Traps"}</span>)}</p>
        <MonsterLevelsChart codes={deck.main} catalog={catalog} />
      </section>
      <details className={styles["de-how"]} open={tipsOpen} onToggle={(event) => setTipsOpen(event.currentTarget.open)}>
        <summary>How to build<ChevronDown className="ic sm" aria-hidden /></summary>
        <dl className={styles["de-tips"]}>
          <div><dt>Add</dt><dd>Double-click, right-click or drag a card from the list.</dd></div>
          <div><dt>Remove</dt><dd>Right-click a card in the deck, press Delete, or drag it back to the list.</dd></div>
          <div><dt>Move</dt><dd>Drag a card between Main, Extra and Side.</dd></div>
          <div><dt>Keys</dt><dd><kbd>/</kbd>{" "}search, <kbd>Ctrl</kbd>{" "}<kbd>Z</kbd>{" "}undo, <kbd>Ctrl</kbd>{" "}<kbd>Shift</kbd>{" "}<kbd>Z</kbd>{" "}redo, <kbd>Ctrl</kbd>{" "}<kbd>S</kbd>{" "}save</dd></div>
        </dl>
      </details>
    </div>
  );
}
