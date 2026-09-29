import { DuelRoomView } from "@/components/duel/room";

export default async function DuelRoomPage({
  params, searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ invite?: string | string[] }>;
}) {
  const [{ slug }, { invite }] = await Promise.all([params, searchParams]);
  return <DuelRoomView slug={slug} inviteCode={typeof invite === "string" ? invite : undefined} />;
}
