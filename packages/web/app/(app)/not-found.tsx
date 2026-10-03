import { EmptyField } from "@/components/layout/empty-field";
import { SheetRoot, SvButton } from "@/components/sheet";

export default function AppNotFound() {
  return (
    <SheetRoot>
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
  );
}
