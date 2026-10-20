import { SavedDeckEditor } from "@/components/decks/editor";
import { resolveSessionIdentity } from "@/lib/session-identity";

export default async function SavedDeckPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ room?: string | string[] }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const roomSlug = typeof query?.room === "string" && /^[a-z0-9]{8}$/.test(query.room) ? query.room : undefined;
  const session = await resolveSessionIdentity();
  return <SavedDeckEditor key={id} deckId={id} roomSlug={roomSlug} viewerId={session.ok ? session.identity.userId : undefined} />;
}
