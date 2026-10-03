import { useId, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type SheetPanelProps = {
  title: ReactNode;
  /** A string goes in `<small>`; any other node (a link, say) is rendered as given. */
  aside?: ReactNode;
  headingLevel?: 2 | 3;
  footer?: ReactNode;
  live?: boolean;
  bodyClassName?: string;
  id?: string;
  className?: string;
  children?: ReactNode;
} & Omit<HTMLAttributes<HTMLElement>, "title" | "className" | "children" | "id">;

/** The captioned Match Sheet panel: `.panel.msheet` > `.sheet-cap` + `.sheet-body` (+ `.sheet-foot`). */
export function SheetPanel({
  title,
  aside,
  headingLevel = 2,
  footer,
  live = false,
  bodyClassName,
  id,
  className,
  children,
  ...rest
}: SheetPanelProps) {
  const autoId = useId();
  const headingId = `${id ?? autoId}-t`;
  const Heading = headingLevel === 3 ? "h3" : "h2";
  const hasAside = aside !== undefined && aside !== null && aside !== false && aside !== "";
  const hasFooter = footer !== undefined && footer !== null && footer !== false && footer !== "";
  return (
    <section {...rest} id={id} className={cn("panel msheet", live && "lv", className)} aria-labelledby={headingId}>
      <header className="sheet-cap">
        <Heading id={headingId}>{title}</Heading>
        {hasAside && (typeof aside === "string" || typeof aside === "number" ? <small>{aside}</small> : aside)}
      </header>
      <div className={cn("sheet-body", bodyClassName)}>{children}</div>
      {hasFooter && <footer className="sheet-foot">{footer}</footer>}
    </section>
  );
}
