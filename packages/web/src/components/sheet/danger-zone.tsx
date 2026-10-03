import { useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Destructive actions sit apart, behind a confirm. */
export function DangerZone({ title = "Danger zone", children, className }: {
  title?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const headingId = useId();
  return (
    <section className={cn("dz", className)} aria-labelledby={headingId}>
      <h4 className="dz-t" id={headingId}>{title}</h4>
      {children}
    </section>
  );
}

export function DangerRow({ title, description, action, className }: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("dz-row", className)}>
      <p>
        <strong>{title}</strong>
        {description}
      </p>
      {action}
    </div>
  );
}
