import styles from "./editor.module.css";

/** What the mouse does on a deck card and on a card in the list. The phone line says what a touch does. */
export function ControlsLegend({ phone = false }: { phone?: boolean }) {
  if (phone) {
    return <p className={styles["de-legend-phone"]}>Tap: select a card · Hold: change art</p>;
  }
  return (
    <section className={styles["de-legend"]} aria-label="Controls">
      <h3 className={styles["de-legend-h"]}>Controls</h3>
      <p className={styles["de-legend-k"]}>Deck cards</p>
      <ul>
        <li><kbd>Left-click</kbd> remove</li>
        <li><kbd>Ctrl+click</kbd> move to/from Side Deck (<kbd>Cmd</kbd> on Mac)</li>
        <li><kbd>Right-click</kbd> change art</li>
      </ul>
      <p className={styles["de-legend-k"]}>Card list</p>
      <ul>
        <li><kbd>Click</kbd> preview</li>
        <li><kbd>Double-click</kbd> or <kbd>Right-click</kbd> add</li>
      </ul>
      <p className={styles["de-legend-k"]}>Keyboard, on a focused deck card</p>
      <ul>
        <li><kbd>Enter</kbd> or <kbd>Space</kbd> select</li>
        <li><kbd>Delete</kbd> remove</li>
        <li><kbd>Ctrl+Enter</kbd> move to/from Side Deck</li>
        <li><kbd>Menu</kbd> or <kbd>Shift+F10</kbd> change art</li>
      </ul>
    </section>
  );
}
