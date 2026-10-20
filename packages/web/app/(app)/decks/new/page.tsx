import { SavedDeckEditor } from "@/components/decks/editor";
import { resolveSessionIdentity } from "@/lib/session-identity";

export default async function NewDeckPage() {
  const session = await resolveSessionIdentity();
  return <SavedDeckEditor viewerId={session.ok ? session.identity.userId : undefined} />;
}
