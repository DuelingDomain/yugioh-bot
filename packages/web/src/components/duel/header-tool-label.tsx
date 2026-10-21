import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/**
 * The content of a header button that gives up its word on a phone (under 400px): the icon shows and the label stays for
 * screen readers, so the header row keeps room for the turn text. Report bug does the same at 600px.
 */
export function HeaderToolLabel({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <>
      <Icon className="hidden size-4 max-[400px]:block" strokeWidth={1.75} aria-hidden />
      <span className="max-[400px]:sr-only">{children}</span>
    </>
  );
}
