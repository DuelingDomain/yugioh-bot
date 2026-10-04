import * as React from "react";

/**
 * Keyboard and combobox wiring for a text input that filters a list of results. ArrowDown and ArrowUp
 * move the highlighted row, Enter picks it (the top match when the user did not move), Escape clears the
 * text. The highlight sits on the first row whenever the list changes, so Enter always does what shows.
 * Spread `inputProps` on the input, `listProps` on the list, and give each row `optionProps(index)`.
 *
 * `resultsFor` is the trimmed text the current `items` were fetched for. While it differs from the text in
 * the input the list is stale (`stale` is true, so the caller can dim it) and Enter does nothing, so a key
 * press never adds a card from an old search. A row click is a deliberate pick of what the user sees, so it
 * still works. Enter is also ignored while an IME composition is open.
 */
export function useResultNav<T>({
  items,
  query,
  resultsFor,
  setQuery,
  onPick,
  canPick = () => true,
}: {
  items: readonly T[];
  query: string;
  /** The trimmed query `items` answers. */
  resultsFor: string;
  setQuery: (query: string) => void;
  onPick: (item: T) => void;
  /** False for a row Enter must not pick, such as a card already at its copy limit. */
  canPick?: (item: T) => boolean;
}) {
  const baseId = React.useId();
  const listId = `${baseId}-list`;
  const optionId = (index: number) => `${baseId}-opt-${index}`;
  const [active, setActive] = React.useState(0);
  // A new list starts at its first row; React drops the stale index while the list is rendered.
  const [seen, setSeen] = React.useState(items);
  if (seen !== items) {
    setSeen(items);
    setActive(0);
  }

  const stale = resultsFor !== query.trim();
  const open = query.trim().length > 0 && items.length > 0;
  const current = open ? Math.min(active, items.length - 1) : -1;

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" && items.length > 0) {
      event.preventDefault();
      setActive((index) => (Math.min(index, items.length - 1) + 1) % items.length);
    } else if (event.key === "ArrowUp" && items.length > 0) {
      event.preventDefault();
      setActive((index) => {
        const now = Math.min(index, items.length - 1);
        return now <= 0 ? items.length - 1 : now - 1;
      });
    } else if (event.key === "Enter") {
      // The input often sits in a form: Enter picks a card, it never submits.
      event.preventDefault();
      if (event.nativeEvent.isComposing || stale) return;
      const item = current >= 0 ? items[current] : undefined;
      if (item !== undefined && canPick(item)) onPick(item);
    } else if (event.key === "Escape" && query !== "") {
      event.stopPropagation();
      setQuery("");
    }
  };

  return {
    stale,
    inputProps: {
      role: "combobox" as const,
      "aria-expanded": open,
      "aria-controls": listId,
      "aria-autocomplete": "list" as const,
      "aria-activedescendant": current >= 0 ? optionId(current) : undefined,
      onKeyDown,
    },
    listProps: { id: listId, role: "listbox" as const },
    optionProps: (index: number) => ({
      id: optionId(index),
      role: "option" as const,
      "aria-selected": index === current,
      "aria-disabled": !canPick(items[index]) || undefined,
      "data-active": index === current ? "" : undefined,
      onMouseMove: () => setActive(index),
      // Keep the focus in the input, so the keyboard keeps working after a click.
      onMouseDown: (event: React.MouseEvent) => event.preventDefault(),
      onClick: () => {
        const item = items[index];
        if (item !== undefined && canPick(item)) onPick(item);
      },
    }),
  };
}
