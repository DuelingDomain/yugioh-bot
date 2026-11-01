import Link from "next/link";
import type { ReactNode } from "react";
export default function DuelsLayout({ children }: { children: ReactNode }) {
  return <>
    {process.env.REMOTE_DUELS === "1" ? <nav aria-label="Duels sections" className="mb-6 flex gap-5 text-sm">
      <Link className="underline" href="/duels">Duels</Link>
      <Link className="underline" href="/duels/remote">Remote Duels</Link>
    </nav> : null}
    {children}
  </>;
}
