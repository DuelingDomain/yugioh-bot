import { SavedDeckEditor } from "@/components/decks/editor";

export default async function SavedDeckPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SavedDeckEditor key={id} deckId={id} />;
}
