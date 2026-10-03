import type { ReactNode } from "react";
import { FieldOutline, Zone } from "@/components/sheet";
import styles from "./empty-field.module.css";

/**
 * The page for "nothing here": a dashed, unlit field outline with a centre line. The big word sits
 * above the line, an empty card slot below it, then the title, a sentence, an optional address
 * and the buttons. Render it inside a `SheetRoot`. Used by the 404 and error pages; the
 * tournament page can use it for its own "not found".
 */
export function EmptyField({ code, title, children, address, reference, actions }: {
  /** The big word: "404" or "Error". */
  code: string;
  title: string;
  /** The explaining sentence. */
  children: ReactNode;
  /** The address that was not found, shown in a small mono chip. */
  address?: string;
  /** An error reference, shown as a quiet mono line under the buttons. */
  reference?: string;
  /** Buttons, usually `SvButton`s. */
  actions?: ReactNode;
}) {
  return (
    <div className={styles.wrap}>
      <FieldOutline lit={false} centreLine className={styles.field}>
        <div className={styles.top}>
          <p className={styles.code} data-long={code.length > 3 ? "true" : undefined}>{code}</p>
        </div>
        <div className={styles.bottom}>
          <Zone state="empty" size="md" />
        </div>
      </FieldOutline>
      <div className={styles.copy}>
        <h1 className={styles.title}>{title}</h1>
        <div className={styles.body}>{typeof children === "string" ? <p>{children}</p> : children}</div>
        {address ? <code className={styles.address}>{address}</code> : null}
        {actions ? <div className={styles.actions}>{actions}</div> : null}
        {reference ? <p className={styles.ref}>Reference {reference}</p> : null}
      </div>
    </div>
  );
}
