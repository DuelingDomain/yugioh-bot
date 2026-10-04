import { PageFrame } from "@/components/dashboard/page-frame";
import { LoadingBody } from "@/components/dashboard/loading-body";

/** The heading is real from the first frame; the body is still blocks until the dashboard arrives. */
export default function DashboardLoading() {
  return (
    <PageFrame title="Dashboard">
      <LoadingBody label="Loading your dashboard" sections={[2, 3, 2]} />
    </PageFrame>
  );
}
