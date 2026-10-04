import { PageFrame } from "@/components/dashboard/page-frame";
import { LoadingBody } from "@/components/dashboard/loading-body";
import { SvButton } from "@/components/sheet";

/** The heading and the New tournament button are real from the first frame; the list is blocks. */
export default function TournamentsLoading() {
  return (
    <PageFrame title="Tournaments" actions={<SvButton as="a" href="/tournaments/new" variant="primary">New tournament</SvButton>}>
      <LoadingBody label="Loading tournaments" sections={[3, 2]} />
    </PageFrame>
  );
}
