import { SavedDeckEditor } from "@/components/decks/editor";
import { auth } from "@/lib/auth";

export default async function NewDeckPage() {
  const session = await auth();
  return <SavedDeckEditor viewerId={session?.user?.id} />;
}
