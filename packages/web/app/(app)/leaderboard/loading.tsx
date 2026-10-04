import { PageFrame } from "@/components/dashboard/page-frame";
import { LoadingBody } from "@/components/dashboard/loading-body";

/** The heading is real from the first frame; the standings are one long block of rows. */
export default function LeaderboardLoading() {
  return (
    <PageFrame title="Leaderboard">
      <LoadingBody label="Loading the leaderboard" sections={[8]} />
    </PageFrame>
  );
}
