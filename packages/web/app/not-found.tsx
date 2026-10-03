import { EmptyField } from "@/components/layout/empty-field";
import { SheetRoot, SvButton } from "@/components/sheet";

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center bg-bg-deep p-4 text-text-primary sm:p-6 lg:p-8">
      {/* .ms is an inline-size container, so it needs a real width inside a centring grid. */}
      <SheetRoot className="w-full max-w-xl">
        <EmptyField
          code="404"
          title="Nothing at this address"
          actions={
            <SvButton as="a" href="/dashboard" variant="primary">
              Back to dashboard
            </SvButton>
          }
        >
          This page does not exist, or it was deleted. The link may have a typo.
        </EmptyField>
      </SheetRoot>
    </main>
  );
}
