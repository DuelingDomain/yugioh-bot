import Link from "next/link";
import { Compass } from "lucide-react";
import { SheetRoot } from "@/components/sheet";

export default function NotFound() {
  return (
    <main className="min-h-screen bg-bg-deep p-4 text-text-primary sm:p-6 lg:p-8">
      <SheetRoot>
        <div className="nf">
          <p className="nf-code">
            <Compass className="ic" aria-hidden="true" />
            404
          </p>
          <h1 className="t-title">Nothing at this address</h1>
          <p>This page does not exist, or it was deleted. The link may have a typo.</p>
          <div className="acts">
            <Link className="btn btn-primary" href="/dashboard">
              Back to dashboard
            </Link>
          </div>
        </div>
      </SheetRoot>
    </main>
  );
}
